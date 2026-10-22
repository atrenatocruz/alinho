#if os(watchOS)
import PadelScoring
import SwiftUI

/// Segundo ecrã (deslizar para o lado; PDF p. 6): resultado, «Últimos jogos» e
/// «Terminar o jogo» (dedo pousado e depois confirmação).
struct GameMenuView: View {
    let match: MatchState

    @EnvironmentObject private var model: AppModel
    @State private var confirmEnd = false

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(match.setsLine)
                        .font(.system(size: 17, weight: .heavy))
                    Text(L.t("Desliza para voltar ao marcador"))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                }
                .listCard()
                NavigationLink {
                    HistoryView()
                } label: {
                    Text(L.t("Últimos jogos"))
                        .font(Theme.number(15))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .overlay(Capsule().strokeBorder(.white, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
                HoldButton(
                    target: .end,
                    fillFromBottom: false,
                    fillColor: Theme.red.opacity(0.28),
                    cornerRadius: 20,
                    onComplete: { confirmEnd = true }
                ) {
                    Text(L.t("Terminar o jogo"))
                        .font(Theme.number(15))
                        .foregroundStyle(Theme.red)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .overlay(Capsule().strokeBorder(Theme.red, lineWidth: 1.5))
                }
                Text(L.t("Mantém o dedo para terminar"))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
            }
        }
        .navigationTitle(match.config.format.title)
        .alert(L.t("Terminar o jogo"), isPresented: $confirmEnd) {
            Button(L.t("Terminar"), role: .destructive) { model.stop() }
            Button(L.t("Cancelar"), role: .cancel) {}
        }
    }
}
#endif
