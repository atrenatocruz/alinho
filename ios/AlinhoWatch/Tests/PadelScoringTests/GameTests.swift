import Testing
@testable import PadelScoring

@Test func newMatchStartsAtZero() {
    let s = match(.bestOf3, .golden, server: .them)
    #expect(s.sets.isEmpty && s.games == [0, 0] && s.points == [0, 0])
    #expect(s.phase == .game && s.server == .them && !s.isOver)
    #expect(match(.points).phase == .points && match(.points, server: .us).server == nil)
}
