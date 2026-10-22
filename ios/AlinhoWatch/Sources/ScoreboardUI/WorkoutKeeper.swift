#if os(watchOS)
import HealthKit

/// Mantém a app à frente durante o jogo, para o ecrã não voltar ao mostrador:
/// uma sessão de treino (padel) sem `HKLiveWorkoutBuilder`, por isso nada fica
/// gravado no Saúde. Se a autorização for recusada, o jogo continua na mesma.
@MainActor
final class WorkoutKeeper: NSObject, HKWorkoutSessionDelegate {
    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    /// Há um jogo a decorrer. O `begin()` espera pela autorização; se o jogo acabar
    /// entretanto, não pode arrancar um treino que já ninguém quer.
    private var wanted = false
    private var starting = false

    func begin() async {
        wanted = true
        guard session == nil, !starting, HKHealthStore.isHealthDataAvailable() else { return }
        starting = true
        defer { starting = false }
        do {
            try await healthStore.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [])
            guard wanted else { return }
            let configuration = HKWorkoutConfiguration()
            configuration.activityType = .paddleSports
            configuration.locationType = .unknown
            let s = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            s.delegate = self
            s.startActivity(with: Date())
            session = s
        } catch {
            session = nil
        }
    }

    func end() {
        wanted = false
        session?.end()
        session = nil
    }

    // O sistema pode acabar a sessão sozinho; assim o próximo `begin()` arranca outra.
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

    private func forget(_ s: HKWorkoutSession) {
        if session === s { session = nil }
    }
}
#endif
