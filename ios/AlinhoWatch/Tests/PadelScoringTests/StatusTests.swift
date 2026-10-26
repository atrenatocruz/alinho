import Foundation
import Testing
@testable import PadelScoring

// Linha de estado: pausa > 40-40 > ponto de jogo > ponto de set > tie-break.

@Test func setPointAndMatchPoint() {
    let (s, _) = games(match(), "uuuuu")                 // 5-0, 0-0
    #expect(play(s, "uuu").0.statusLine == .setPoint)   // 40-0 a 5-0
    let (m, _) = games(match(), "uuuuuu uuuuu")          // 1 set, 5-0
    #expect(play(m, "uuu").0.statusLine == .matchPoint)
}

@Test func endlessSetHasNoMatchPoint() {
    let (s, _) = games(match(.endlessSet), String(repeating: "ut", count: 11) + "u")
    #expect(play(s, "uuu").0.statusLine == .gamesRound(us: 12, them: 11, total: nil))
}

@Test func deuceLabelBeatsSetPoint() {
    let (s, _) = games(match(), "uuuuu")
    #expect(play(s, "uuuttt").0.statusLine == .goldenPoint)
}

@Test func tieBreakAndPlainStatus() {
    #expect(match().statusLine == nil)
    let (s, _) = games(match(), "ut ut ut ut ut ut")
    #expect(s.statusLine == .tieBreak)
}

@Test func elapsedSkipsPauses() {
    var s = match()
    s.pausedSeconds = 300
    #expect(s.elapsed(at: t0.addingTimeInterval(1500)) == 1200)
    s.pausedAt = t0.addingTimeInterval(1400)
    #expect(s.elapsed(at: t0.addingTimeInterval(1500)) == 1100)
    #expect(s.statusLine == .paused)
}

@Test func minutesTextFloors() {
    #expect(minutesText(59) == "0 min" && minutesText(23 * 60 + 40) == "23 min")
}

@Test func switchSidesScoreShowsTheRightNumbers() {
    // Jogo a meio do set: os jogos do set.
    #expect(games(match(), "uuu").0.switchSidesScore == [3, 0])
    // Set acabado de fechar (6-3): esse set.
    #expect(games(match(), "uuuuu ttt u").0.switchSidesScore == [6, 3])
    // Super tie-break (6 pontos somados): os pontos, não o set anterior.
    let (s, _) = games(match(.twoSetsSuperTieBreak), "uuuuuu tttttt")
    #expect(s.phase == .superTieBreak)
    #expect(play(s, "uuuutt").0.switchSidesScore == [4, 2])
}
