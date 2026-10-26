#if os(watchOS)
import Foundation
import PadelScoring

/// Textos do relógio: a chave é o texto em português (Localizable.xcstrings).
enum L {
    static func t(_ key: String.LocalizationValue) -> String {
        String(localized: key, bundle: .module)
    }
}

extension MatchFormat {
    var title: String {
        switch self {
        case .bestOf3: L.t("Melhor de 3 sets")
        case .twoSetsSuperTieBreak: L.t("2 sets + super tie-break")
        case .proSet9: L.t("Pro set a 9")
        case .oneSet: L.t("1 set")
        case .endlessSet: L.t("Set sem fim")
        case .points: L.t("Pontos corridos")
        }
    }

    var shortTitle: String {
        switch self {
        case .bestOf3: L.t("Melhor de 3")
        case .twoSetsSuperTieBreak: L.t("2 sets + super")
        default: title
        }
    }
}

extension DeuceMode {
    var title: String {
        switch self {
        case .golden: L.t("Ponto de ouro")
        case .starPoint: L.t("Star Point")
        case .advantage: L.t("Vantagens")
        }
    }

    var help: String {
        switch self {
        case .golden: L.t("Aos 40-40 joga-se um ponto só.")
        case .starPoint: L.t("Duas vantagens; se continuar, um ponto decide.")
        case .advantage: L.t("Ganha quem fizer 2 pontos seguidos.")
        }
    }
}

enum Labels {
    static func server(_ team: Team?) -> String {
        switch team {
        case nil: L.t("Não mostrar")
        case .us?: L.t("Nós")
        case .them?: L.t("Eles")
        }
    }

    /// Nas listas do Novo jogo: «Eu», «O meu parceiro».
    static func player(_ p: Player) -> String {
        switch p {
        case .me: L.t("Eu")
        case .partner: L.t("O meu parceiro")
        }
    }

    /// Por baixo da bola de quem serve: «Tu · direita», «Parceiro · esquerda», «Servem».
    static func serve(_ team: Team, _ info: ServeInfo?) -> String? {
        guard let info else { return nil }
        if team == .them { return info.them ? L.t("Servem") : nil }
        guard case .player(let p, let side)? = info.us else { return nil }
        let who = p == .me ? L.t("Tu") : L.t("Parceiro")
        let where_ = side == .right ? L.t("direita") : L.t("esquerda")
        return "\(who) · \(where_)"
    }

    static func effort(_ e: EffortLabel) -> String {
        switch e {
        case .easy: L.t("Fácil")
        case .moderate: L.t("Moderado")
        case .hard: L.t("Difícil")
        case .max: L.t("No limite")
        }
    }

    static func layout(_ l: ScoreLayout) -> String {
        switch l {
        case .side: L.t("Lado a lado")
        case .stack: L.t("Um por cima do outro")
        }
    }

    static func pointsTotal(_ total: Int?) -> String {
        guard let total else { return L.t("Sem total") }
        return L.t("\(total) pontos")
    }

    static func status(_ s: StatusLabel) -> String {
        switch s {
        case .goldenPoint: L.t("Ponto de ouro")
        case .starPoint: L.t("Star Point")
        case .deuce(nil): L.t("Iguais")
        case .deuce(let n?): L.t("Iguais \(n)")
        case .advantage(nil): L.t("Vantagem")
        case .advantage(let n?): L.t("Vantagem \(n)")
        case .tieBreak: L.t("Tie-break a 7")
        case .superTieBreak: L.t("Super tie-break a 10")
        case .points(nil): L.t("Pontos corridos")
        case .points(let total?): L.t("Pontos corridos · até \(total)")
        case .gamesRound(let a, let b, nil): L.t("Jogos \(a)-\(b)")
        case .gamesRound(let a, let b, let total?): L.t("Jogos \(a)-\(b) · até \(total)")
        case .paused: L.t("Em pausa")
        case .setPoint: L.t("Ponto de set")
        case .matchPoint: L.t("Ponto de jogo")
        }
    }

    static func mark(_ m: PointMark) -> String {
        switch m {
        case .value(let v): v
        case .advantage: L.t("Vant.")
        }
    }

    static func winner(_ team: Team?) -> String {
        switch team {
        case nil: L.t("Empatado")
        case .us?: L.t("Ganhámos")
        case .them?: L.t("Ganharam eles")
        }
    }
}
#endif
