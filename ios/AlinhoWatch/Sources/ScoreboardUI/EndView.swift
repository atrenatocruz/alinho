#if os(watchOS)
import AlinhoSync
import PadelScoring
import SwiftUI

/// Fim (protótipo de 23 out): quem ganhou, o resultado em grande, formato e duração
/// (ou a nota de terminado antes do fim), o treino e o esforço; «Novo jogo»,
/// «Últimos jogos» e «↺ Desfazer» até se começar outro jogo.
struct EndView: View {
    let match: MatchState

    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var mix: MixModel

    private var record: MatchRecord? { model.session.history.first { $0.id == match.id } }

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
                if let line = mixLine {
                    Text(line)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(mixColor)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Group {
                    Text(note)
                    if let health = healthLine { Text(health) }
                }
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                Button(L.t("Novo jogo")) { model.newMatch() }
                    .buttonStyle(LimeButtonStyle())
                    .padding(.top, 6)
                NavigationLink {
                    HistoryView()
                } label: {
                    Text(L.t("Últimos jogos"))
                }
                .buttonStyle(OutlineButtonStyle())
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
                Text(L.t("Para sair, carrega na coroa."))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
            }
        }
        .task(id: match.id) { await mix.updateStatus() }
    }

    /// Só nos jogos do mix: em que ponto está o envio do resultado.
    private var mixLine: String? {
        guard mix.mixLink(for: match.id) != nil else { return nil }
        return MixText.status(mix.sendStatus)
    }

    private var mixColor: Color {
        switch mix.sendStatus {
        case .sent: Theme.lime
        case .dropped: Theme.amber
        default: Theme.muted
        }
    }

    private var note: String {
        guard match.endReason == .stopped else {
            let end = match.endedAt ?? match.startedAt
            let played = durationText(from: match.startedAt, to: match.startedAt.addingTimeInterval(match.elapsed(at: end)))
            return "\(match.config.format.shortTitle) · \(played)"
        }
        var text = L.t("Terminado antes do fim")
        if !(match.phase == .points && match.pointsScoring == .rally) && match.points != [0, 0] {
            let d = match.display
            text += "\n" + L.t("O jogo a meio (\(Labels.mark(d.us))-\(Labels.mark(d.them))) não conta.")
        }
        return text
    }

    /// «♥ 142 bpm · 610 kcal · esforço 7», só com o que houver.
    private var healthLine: String? {
        guard let record else { return nil }
        var parts: [String] = []
        if let bpm = record.averageHeartRate {
            parts.append("♥ \(bpm) bpm")
            if let kcal = record.activeKilocalories { parts.append("\(kcal) kcal") }
        }
        if let effort = record.effort { parts.append(L.t("esforço \(effort)")) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
#endif
