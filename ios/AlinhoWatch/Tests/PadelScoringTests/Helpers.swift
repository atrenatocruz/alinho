import Foundation
@testable import PadelScoring

let t0 = Date(timeIntervalSince1970: 1_800_000_000)

func match(
    _ format: MatchFormat = .bestOf3,
    _ mode: DeuceMode = .golden,
    server: Team? = nil,
    total: Int? = 24
) -> MatchState {
    Scoring.newMatch(
        MatchConfig(format: format, deuceMode: mode, firstServer: server, pointsTotal: total),
        at: t0
    )
}
