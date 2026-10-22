#if os(watchOS)
import HealthKit

/// Mantém a app à frente durante o jogo, para o ecrã não voltar ao mostrador:
/// uma sessão de treino (padel) sem `HKLiveWorkoutBuilder`, por isso nada fica
/// gravado no Saúde. Se a autorização for recusada, o jogo continua na mesma.
@MainActor
final class WorkoutKeeper {
    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?

    func begin() async {
        guard session == nil, HKHealthStore.isHealthDataAvailable() else { return }
        do {
            try await healthStore.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [])
            let configuration = HKWorkoutConfiguration()
            configuration.activityType = .paddleSports
            configuration.locationType = .unknown
            let s = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            s.startActivity(with: Date())
            session = s
        } catch {
            session = nil
        }
    }

    func end() {
        session?.end()
        session = nil
    }
}
#endif
