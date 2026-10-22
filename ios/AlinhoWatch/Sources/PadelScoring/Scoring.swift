import Foundation

/// Regras de pontuação do BA (spec, «Regras de pontuação»). Funções puras: cada
/// uma recebe um estado e devolve outro, para o desfazer ser só guardar estados.
public enum Scoring {
    public static func newMatch(_ config: MatchConfig, id: UUID = UUID(), at date: Date) -> MatchState {
        let isPoints = config.format == .points
        return MatchState(
            id: id,
            config: config,
            sets: [],
            games: [0, 0],
            points: [0, 0],
            phase: isPoints ? .points : .game,
            deuceCount: 0,
            server: isPoints ? nil : config.firstServer,
            tieBreakFirstServer: nil,
            startedAt: date,
            endedAt: nil,
            endReason: nil,
            winner: nil
        )
    }
}
