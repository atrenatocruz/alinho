import Testing
@testable import PadelScoring

@Test func newMatchStartsAtZero() {
    let s = match(.bestOf3, .golden, server: .them)
    #expect(s.sets.isEmpty && s.games == [0, 0] && s.points == [0, 0])
    #expect(s.phase == .game && s.server == .them && !s.isOver)
    #expect(match(.points).phase == .points && match(.points, server: .us).server == .us)
}

@Test func plainGame() {
    let (s, ev) = play(match(), "uuuu")
    #expect(s.games == [1, 0] && s.points == [0, 0])
    #expect(ev.last!.contains(.gameWon))
}

@Test func goldenPointDecides() {
    let (s, ev) = play(match(.bestOf3, .golden), "uuuttt")
    #expect(ev.last!.contains(.decisivePoint) && s.display.status == .goldenPoint)
    #expect(play(s, "t").0.games == [0, 1])
}

@Test func advantageHasNoLimit() {
    let (s, _) = play(match(.bestOf3, .advantage), "uuuttt utut utut")
    #expect(s.points == [3, 3] && s.display.status == .deuce(nil))
    let (a, _) = play(s, "u")
    #expect(a.display == ScoreDisplay(us: .advantage, them: .value("40"), status: .advantage(nil)))
    #expect(play(a, "u").0.games == [1, 0])
}

@Test func starPointSequence() {
    var (s, _) = play(match(.bestOf3, .starPoint), "uuuttt")
    #expect(s.display.status == .deuce(1))
    (s, _) = play(s, "u"); #expect(s.display.status == .advantage(1))
    (s, _) = play(s, "t"); #expect(s.display.status == .deuce(2))
    (s, _) = play(s, "t"); #expect(s.display.status == .advantage(2))
    let (s3, ev) = play(s, "u")
    #expect(s3.display.status == .starPoint && ev.last!.contains(.decisivePoint))
    #expect(play(s3, "u").0.games == [1, 0])
}

@Test func starPointWinOnFirstAdvantage() {
    #expect(play(match(.bestOf3, .starPoint), "uuuttt uu").0.games == [1, 0])
}

@Test func serverAlternatesEachGame() {
    #expect(play(match(server: .us), "uuuu").0.server == .them)
}
