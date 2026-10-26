import Testing
@testable import PadelScoring

@Test func gameLabels() {
    #expect(play(match(), "ut").0.display == ScoreDisplay(us: .value("15"), them: .value("15"), status: nil))
    #expect(play(match(), "uuut").0.display == ScoreDisplay(us: .value("40"), them: .value("15"), status: nil))
}
