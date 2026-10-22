#if os(watchOS)
import PadelScoring
import SwiftUI

/// Aviso no ecrã todo a lima, 2 s (PDF p. 6): «⇄ Trocar de lado» ou o ponto
/// decisivo. Volta sozinho ao marcador (`AppModel.show`).
struct OverlayView: View {
    let overlay: Overlay
    let match: MatchState

    var body: some View {
        ZStack {
            Theme.lime.ignoresSafeArea()
            VStack(spacing: 8) {
                switch overlay {
                case .switchSides:
                    Image(systemName: "arrow.left.arrow.right")
                        .font(.system(size: 34, weight: .black))
                    Text(L.t("Trocar de lado"))
                        .font(Theme.number(30))
                    Text(scoreLine)
                        .font(.system(size: 14, weight: .bold))
                case .decisive(let status):
                    Text(Labels.status(status))
                        .font(Theme.number(30))
                    Text(L.t("Quem recebe escolhe o lado"))
                        .font(.system(size: 14, weight: .bold))
                }
            }
            .foregroundStyle(Theme.ink)
            .multilineTextAlignment(.center)
            .minimumScaleFactor(0.6)
            .padding(.horizontal, 10)
        }
    }

    /// Os jogos do set (ou o set que acabou de fechar) e, se se mostra, quem serve.
    private var scoreLine: String {
        let games = match.games == [0, 0] ? match.sets.last.map { [$0.us, $0.them] } ?? match.games : match.games
        let score = "\(games[0])-\(games[1])"
        switch match.server {
        case .us?: return L.t("\(score) · Nós servimos")
        case .them?: return L.t("\(score) · Eles servem")
        case nil: return score
        }
    }
}
#endif
