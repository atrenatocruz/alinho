import Foundation

/// Pulso em baixo (Always On): o toque que acorda o ecrã nunca dá ponto, nem um
/// toque comprido que comece logo a seguir (a manga ainda a roçar).
public enum WakeGuard {
    /// Depois de acordar, quanto tempo um toque ainda não conta.
    public static let settle: TimeInterval = 0.4

    public static func allowsHold(dimmedAtStart: Bool, startedAt: Date, wokeAt: Date?) -> Bool {
        if dimmedAtStart { return false }
        guard let wokeAt else { return true }
        return startedAt.timeIntervalSince(wokeAt) >= settle
    }
}
