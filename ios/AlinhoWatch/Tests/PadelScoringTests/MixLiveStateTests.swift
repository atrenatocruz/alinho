import Foundation
import Testing
@testable import PadelScoring

// O placar ao vivo de um jogo do mix (Fase B): do `MatchState` do relógio
// («nós/eles») para o `state` v1 do `push_mix_live_score` (dupla A / dupla B).

@Test func liveStateSideAKeepsOrder() {
    // 6-4 fechado, 2-1 no segundo, 15-0 a decorrer.
    let (s, _) = games(match(.bestOf3, server: .us), "uuuutttt uu" + "utu")
    let (s2, _) = play(s, "u")
    let live = MixLiveState(s2, side: .a)
    #expect(live.v == 1)
    #expect(live.sets == [[6, 4]])
    #expect(live.games == [2, 1])
    #expect(live.points == ["15", "0"])
    #expect(live.phase == "game")
    #expect(!live.paused && !live.over)
}

@Test func liveStateSideBSwaps() {
    let (s, _) = games(match(.bestOf3, server: .us), "uuuutttt uu" + "utu")
    let (s2, _) = play(s, "u")
    let live = MixLiveState(s2, side: .b)
    #expect(live.sets == [[4, 6]])
    #expect(live.games == [1, 2])
    #expect(live.points == ["0", "15"])
}

@Test func liveStateServerFollowsSide() {
    let s = match(.bestOf3, server: .us)
    #expect(MixLiveState(s, side: .a).server == "a")
    #expect(MixLiveState(s, side: .b).server == "b")
    #expect(MixLiveState(match(.bestOf3, server: nil), side: .a).server == nil)
}

@Test func liveStateAdvantage() {
    let (s, _) = play(match(.bestOf3, .advantage), "uuuttt u")
    let live = MixLiveState(s, side: .a)
    #expect(live.points == ["AD", "40"])
    #expect(MixLiveState(s, side: .b).points == ["40", "AD"])
}

@Test func liveStateTieBreak() {
    // 6-6 e depois 2-1 no tie-break.
    let (s, _) = games(match(.proSet9), "ut ut ut ut ut ut ut ut")
    let (s2, _) = play(s, "uut")
    let live = MixLiveState(s2, side: .a)
    #expect(live.phase == "tie_break")
    #expect(live.games == [8, 8])
    #expect(live.points == ["2", "1"])
}

@Test func liveStateRallyPoints() {
    let (s, _) = play(match(.points, total: 24), "uuut")
    let live = MixLiveState(s, side: .a)
    #expect(live.phase == "points")
    #expect(live.games == [0, 0])
    #expect(live.points == ["3", "1"])
}

@Test func liveStateEndlessSetCountsGames() {
    let (s, _) = games(match(.endlessSet), "uut")
    let (s2, _) = play(s, "t")
    let live = MixLiveState(s2, side: .a)
    #expect(live.phase == "game")
    #expect(live.games == [2, 1])
    #expect(live.points == ["0", "15"])
}

@Test func liveStatePausedAndOver() {
    var s = match(.bestOf3)
    s.pausedAt = t0
    #expect(MixLiveState(s, side: .a).paused)
    let (done, _) = games(match(.bestOf3), "uuuuuu uuuuuu")
    #expect(MixLiveState(done, side: .a).over)
}

@Test func liveStateEncodesSnakeKeys() throws {
    let data = try JSONEncoder().encode(MixLiveState(match(.bestOf3, server: .them), side: .a))
    let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    #expect(Set(obj.keys) == ["v", "sets", "games", "points", "phase", "server", "paused", "over"])
    #expect(obj["server"] as? String == "b")
}
