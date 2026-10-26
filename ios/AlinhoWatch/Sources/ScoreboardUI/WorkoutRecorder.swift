#if os(watchOS)
import Foundation
import HealthKit
import PadelScoring

/// O treino de cada jogo no Saúde (padel): mantém a app à frente para o ecrã não
/// voltar ao mostrador, mostra a pulsação e as calorias e, no fim, grava o treino.
/// Sem autorização o jogo continua na mesma; só não há treino nem números.
///
/// O treino só se grava em `finish`, que o `AppModel` chama em «Novo jogo» ou uns
/// minutos depois do fim: até lá o «Desfazer» do fim retoma o mesmo treino, sem
/// deixar um treino a dobrar.
@MainActor
final class WorkoutRecorder: NSObject, ObservableObject {
    @Published private(set) var heartRate: Int?
    @Published private(set) var averageHeartRate: Int?
    @Published private(set) var kilocalories: Double = 0
    /// `nil` = ainda não se pediu; `false` = recusado (ou o Saúde não existe).
    @Published private(set) var authorized: Bool?

    /// Limites das zonas 1 a 5 (bpm). O watchOS não dá as zonas do utilizador por API.
    static let zoneLimits = [110, 125, 140, 155]

    static func zone(_ bpm: Int) -> Int {
        (zoneLimits.firstIndex { bpm < $0 } ?? zoneLimits.count) + 1
    }

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var matchID: UUID?
    /// Há um jogo a decorrer. O `begin` espera pela autorização; se o jogo acabar
    /// entretanto, não pode arrancar um treino que já ninguém quer.
    private var wanted = false
    private var starting = false

    private var shareTypes: Set<HKSampleType> {
        var types: Set<HKSampleType> = [HKObjectType.workoutType()]
        if #available(watchOS 11.0, *) { types.insert(HKQuantityType(.workoutEffortScore)) }
        return types
    }

    private let readTypes: Set<HKObjectType> = [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)]

    func begin(matchID: UUID) async {
        wanted = true
        guard session == nil, !starting else { return }
        guard HKHealthStore.isHealthDataAvailable() else { authorized = false; return }
        starting = true
        defer { starting = false }
        do {
            try await healthStore.requestAuthorization(toShare: shareTypes, read: readTypes)
            authorized = healthStore.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized
            guard wanted, authorized == true else { return }
            // A app pode ter fechado a meio: retoma o treino que ficou aberto.
            if let recovered = try? await healthStore.recoverActiveWorkoutSession() {
                attach(recovered, matchID: matchID)
                return
            }
            let configuration = HKWorkoutConfiguration()
            configuration.activityType = .paddleSports
            configuration.locationType = .unknown
            let s = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
            attach(s, matchID: matchID)
            let now = Date()
            s.startActivity(with: now)
            try await b.beginCollection(at: now)
        } catch {
            session = nil
            builder = nil
        }
    }

    private func attach(_ s: HKWorkoutSession, matchID: UUID) {
        s.delegate = self
        s.associatedWorkoutBuilder().delegate = self
        session = s
        builder = s.associatedWorkoutBuilder()
        self.matchID = matchID
    }

    func pause() { session?.pause() }

    func resume() { session?.resume() }

    /// Fecha e grava o treino, com o resultado e, em watchOS 11, o esforço.
    func finish(record: MatchRecord) async {
        wanted = false
        guard let session, let builder, matchID == record.id else { discard(); return }
        self.session = nil
        self.builder = nil
        session.end()
        do {
            try await builder.endCollection(at: record.endedAt)
            try await builder.addMetadata([
                "alinho.match.id": record.id.uuidString,
                "alinho.result": record.resultText,
            ])
            guard let workout = try await builder.finishWorkout() else { return }
            if #available(watchOS 11.0, *), let effort = record.effort {
                let sample = HKQuantitySample(
                    type: HKQuantityType(.workoutEffortScore),
                    quantity: HKQuantity(unit: .appleEffortScore(), doubleValue: Double(effort)),
                    start: record.startedAt,
                    end: record.endedAt
                )
                try await healthStore.relateWorkoutEffortSample(sample, with: workout, activity: nil)
            }
        } catch {
            // O jogo já está guardado no relógio; um treino que falha não o estraga.
        }
    }

    /// Jogo sem pontos (ou sem registo): não fica treino nenhum.
    func discard() {
        wanted = false
        session?.end()
        builder?.discardWorkout()
        session = nil
        builder = nil
        heartRate = nil
        averageHeartRate = nil
        kilocalories = 0
    }

    /// Só nas prints dos ecrãs: números fixos, sem Saúde.
    func preview(heartRate: Int?, averageHeartRate: Int?, kilocalories: Double, authorized: Bool) {
        self.heartRate = heartRate
        self.averageHeartRate = averageHeartRate
        self.kilocalories = kilocalories
        self.authorized = authorized
    }

    fileprivate func collected(_ statistics: [HKStatistics]) {
        for s in statistics {
            switch s.quantityType {
            case HKQuantityType(.heartRate):
                let bpm = HKUnit.count().unitDivided(by: .minute())
                heartRate = s.mostRecentQuantity().map { Int($0.doubleValue(for: bpm).rounded()) }
                averageHeartRate = s.averageQuantity().map { Int($0.doubleValue(for: bpm).rounded()) }
            case HKQuantityType(.activeEnergyBurned):
                kilocalories = s.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? kilocalories
            default:
                break
            }
        }
    }

    fileprivate func forget(_ s: HKWorkoutSession) {
        if session === s {
            session = nil
            builder = nil
        }
    }
}

extension WorkoutRecorder: HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    // O sistema pode acabar a sessão sozinho; assim o próximo `begin` arranca outra.
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        guard toState == .ended || toState == .stopped else { return }
        Task { @MainActor in self.forget(workoutSession) }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in self.forget(workoutSession) }
    }

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let stats = collectedTypes.compactMap { $0 as? HKQuantityType }.compactMap { workoutBuilder.statistics(for: $0) }
        Task { @MainActor in self.collected(stats) }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}
#endif
