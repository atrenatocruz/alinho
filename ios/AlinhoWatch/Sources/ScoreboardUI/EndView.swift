#if os(watchOS)
import PadelScoring
import SwiftUI

/// Fim (PDF p. 6): quem ganhou, o resultado em grande, formato e duração (ou a
/// nota de terminado antes do fim) e «Novo jogo». Por baixo, «↺ Desfazer» até
/// se começar outro jogo (proposta nossa, por confirmar com o Francisco).
struct EndView: View {
    let match: MatchState

    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Text(Labels.winner(match.winner))
                    .font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(match.winner == nil ? .white : Theme.lime)
                Text(match.resultText)
                    .font(Theme.number(30))
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.5)
                Text(note)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                Button(L.t("Novo jogo")) { model.newMatch() }
                    .buttonStyle(LimeButtonStyle())
                    .padding(.top, 6)
                if model.session.canUndo {
                    HoldButton(
                        target: .undo,
                        fillFromBottom: false,
                        fillColor: .white.opacity(0.22),
                        cornerRadius: 20,
                        onComplete: model.undo
                    ) {
                        Text("↺ " + L.t("Desfazer"))
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .overlay(Capsule().strokeBorder(.white, lineWidth: 1.5))
                    }
                }
            }
        }
    }

    private var note: String {
        guard match.endReason == .stopped else {
            return "\(match.config.format.title) · \(durationText(from: match.startedAt, to: match.endedAt ?? match.startedAt))"
        }
        var text = L.t("Terminado antes do fim.")
        if !(match.phase == .points && match.pointsScoring == .rally) && match.points != [0, 0] {
            let d = match.display
            text += "\n" + L.t("O jogo a meio (\(Labels.mark(d.us))-\(Labels.mark(d.them))) não conta.")
        }
        return text
    }
}
#endif
