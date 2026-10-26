import Testing
@testable import PadelScoring

@Test func setTo6() {
    let (s, ev) = games(match(), "uuuutttt uu")
    #expect(s.sets == [SetScore(6, 4, .normal)] && s.games == [0, 0])
    #expect(ev.last!.contains(.setWon) && !ev.last!.contains(.switchSides))
}

@Test func setAt6_3SwitchesSides() {
    let (_, ev) = games(match(), "uuuttt uuu")
    #expect(ev.last!.contains(.setWon) && ev.last!.contains(.switchSides))
}

@Test func oddGamesSwitch() {
    let (_, ev) = games(match(), "uuu")
    #expect(ev[0].contains(.switchSides))
    #expect(!ev[1].contains(.switchSides))
    #expect(ev[2].contains(.switchSides))
}

/// 6-6 num `bestOf3`/`oneSet`: Nós e Eles ganham 5 cada, depois um cada.
private func atSixAll(_ s: MatchState) -> MatchState {
    games(s, "uuuuu ttttt u t").0
}

@Test func tieBreakAt6_6() {
    let s = atSixAll(match())
    #expect(s.phase == .tieBreak)
    #expect(s.display == ScoreDisplay(us: .value("0"), them: .value("0"), status: .tieBreak))
}

@Test func tieBreakWinBy2() {
    let (s, _) = play(atSixAll(match()), "uuuuuu tttttt u")
    #expect(s.phase == .tieBreak && s.points == [7, 6])
    let (done, ev) = play(s, "u")
    #expect(done.sets.last == SetScore(7, 6, .tieBreak))
    #expect(done.phase == .game && done.games == [0, 0] && done.points == [0, 0])
    #expect(ev.last!.contains(.setWon))
}

@Test func tieBreakSwitchEvery6() {
    let (_, ev) = play(atSixAll(match()), "utututututut")
    #expect(!ev[4].contains(.switchSides))
    #expect(ev[5].contains(.switchSides))
    #expect(!ev[6].contains(.switchSides))
    #expect(ev[11].contains(.switchSides))
}

@Test func tieBreakServeOrder() {
    var s = atSixAll(match(server: .us))
    #expect(s.tieBreakFirstServer == .us)
    var servers: [Team?] = []
    for c in "utut ut" where c != " " {
        servers.append(s.server)
        s = play(s, String(c)).0
    }
    #expect(servers == [.us, .them, .them, .us, .us, .them])
    let done = play(s, "uuuuuuu").0
    #expect(done.phase == .game && done.server == .them)
}

@Test func proSet9() {
    let (s, _) = games(match(.proSet9), "uuuuuuuu tttttttt")
    #expect(s.phase == .tieBreak)
    let (done, ev) = play(s, "uuuuuuu")
    #expect(done.sets == [SetScore(9, 8, .tieBreak)])
    #expect(done.isOver && done.winner == .us && ev.last!.contains(.matchOver))
}

@Test func bestOf3Ends() {
    let (s, ev) = games(match(), "uuuuuu uuuuuu")
    #expect(s.isOver && s.endReason == .rules && s.winner == .us)
    #expect(ev.last!.contains(.matchOver) && !ev.last!.contains(.switchSides))
}

@Test func oneSetEnds() {
    let (s, _) = games(match(.oneSet), "tttttt")
    #expect(s.isOver && s.winner == .them && s.sets == [SetScore(0, 6, .normal)])
}

@Test func superTieBreakAt1_1() {
    let (s, _) = games(match(.twoSetsSuperTieBreak), "uuuuuu tttttt")
    #expect(s.phase == .superTieBreak && s.display.status == .superTieBreak)
    let (done, ev) = play(s, "tttttttt uuuuuuuuuu")
    #expect(done.sets.last == SetScore(10, 8, .superTieBreak))
    #expect(done.isOver && done.winner == .us && ev.last!.contains(.matchOver))
}

@Test func modesNotInTieBreak() {
    let (s, _) = play(atSixAll(match(.bestOf3, .starPoint)), "uuu ttt")
    #expect(s.display == ScoreDisplay(us: .value("3"), them: .value("3"), status: .tieBreak))
}
