#if os(watchOS)
import PadelScoring
import SwiftUI

/// Últimos jogos (PDF p. 6): resultado, quem ganhou, dia, formato e «Terminado».
struct HistoryView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                if model.session.history.isEmpty {
                    Text(L.t("Ainda não há jogos. Acaba um e aparece aqui."))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(model.session.history) { record in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(record.resultText)
                            .font(.system(size: 16, weight: .heavy))
                        Text(caption(record))
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.muted)
                    }
                    .listCard()
                }
            }
        }
        .navigationTitle(L.t("Últimos jogos"))
    }

    private func caption(_ r: MatchRecord) -> String {
        let day = r.endedAt.formatted(.dateTime.day().month(.abbreviated)).replacingOccurrences(of: ".", with: "")
        var parts = [Labels.winner(r.winner), day, r.format.shortTitle]
        if r.endReason == .stopped { parts.append(L.t("Terminado")) }
        return parts.joined(separator: " · ")
    }
}
#endif
