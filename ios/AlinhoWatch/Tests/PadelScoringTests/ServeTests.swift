import Foundation
import Testing
@testable import PadelScoring

// Quem serve na nossa dupla e de que lado («Tu · direita»).

@Test func ourPairAlternatesServer() {
    var (s, _) = games(match(server: .us, first: .partner), "")
    #expect(s.serveInfo == ServeInfo(us: .player(.partner, .right), them: false))
    (s, _) = games(s, "u")                       // servem eles
    #expect(s.serveInfo == ServeInfo(us: nil, them: true))
    (s, _) = games(s, "t")                       // voltamos a servir: o outro
    #expect(s.ourServer == .me)
}

@Test func serveSideFollowsPointParity() {
    let (s, _) = play(match(server: .us), "u")
    #expect(s.serveInfo?.us == .player(.me, .left))
    let (t, _) = play(match(server: .us), "ut")
    #expect(t.serveInfo?.us == .player(.me, .right))
}

@Test func tieBreakAlternatesOurPlayers() {
    // 6-6 com Nós a abrir o tie-break: 1.º ponto eu; pontos 4-5 voltamos com o parceiro.
    let (s, _) = games(match(server: .us), "ut ut ut ut ut ut")
    #expect(s.phase == .tieBreak && s.server == .us && s.ourServer == .me)
    let (tb, _) = play(s, "uuu")
    #expect(tb.server == .us && tb.ourServer == .partner)
}

@Test func noServerMeansNoServeInfo() {
    #expect(match().serveInfo == nil)
}

@Test func configWithoutOurFirstServerDecodes() throws {
    let json = #"{"format":"m3","deuceMode":"ouro","pointsTotal":24}"#
    let c = try JSONDecoder().decode(MatchConfig.self, from: Data(json.utf8))
    #expect(c.ourFirstServer == .me && c.firstServer == nil && c.layout == .side)
}
