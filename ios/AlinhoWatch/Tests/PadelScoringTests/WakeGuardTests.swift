import Foundation
import Testing
@testable import PadelScoring

// Pulso em baixo: o primeiro toque só acorda o ecrã, nunca dá ponto.

@Test func wakeGuardIgnoresHoldFromDimmedScreen() {
    #expect(!WakeGuard.allowsHold(dimmedAtStart: true, startedAt: t0, wokeAt: nil))
    #expect(!WakeGuard.allowsHold(dimmedAtStart: false, startedAt: t0.addingTimeInterval(0.3), wokeAt: t0))
    #expect(WakeGuard.allowsHold(dimmedAtStart: false, startedAt: t0.addingTimeInterval(0.5), wokeAt: t0))
    #expect(WakeGuard.allowsHold(dimmedAtStart: false, startedAt: t0, wokeAt: nil))
}
