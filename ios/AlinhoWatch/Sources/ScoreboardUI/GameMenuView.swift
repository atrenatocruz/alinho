#if os(watchOS)
import PadelScoring
import SwiftUI

/// Segundo ecrã (deslizar para a direita; protótipo de 23 out): resultado e minutos,
/// pausa, acertar o marcador, mudar quem serve, o 40-40, «Últimos jogos» e
/// «Terminar o jogo» (dedo pousado e depois «Terminar o jogo?»).
struct GameMenuView: View {
    let match: MatchState

    @EnvironmentObject private var model: AppModel
    @State private var confirmEnd = false

    private var shownDeuceMode: DeuceMode { match.nextDeuceMode ?? match.deuceMode }

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(liveLine)
                        .font(.system(size: 17, weight: .heavy))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(L.t("\(minutesText(match.elapsed(at: Date()))) de jogo"))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                }
                .listCard()
                Button { model.togglePause() } label: {
                    menuRow(match.pausedAt == nil ? L.t("Pausar") : L.t("Continuar"))
                }
                NavigationLink {
                    CorrectScoreView(match: match).subscreen(model)
                } label: {
                    menuRow(L.t("Acertar o marcador"))
                }
                if match.server != nil && !(match.phase == .points && match.pointsScoring == .rally) {
                    NavigationLink {
                        OptionListView(
                            title: L.t("Quem serve agora"),
                            options: ServeChoice.allCases.map { Option(value: $0, label: $0.label) },
                            selected: ServeChoice(match),
                            help: { _ in L.t("Vale do próximo ponto em diante.") },
                            onPick: { model.setServer($0.team, player: $0.player) }
                        )
                        .subscreen(model)
                    } label: {
                        menuRow(L.t("Mudar quem serve"))
                    }
                }
                if !(match.phase == .points && match.pointsScoring == .rally) {
                NavigationLink {
                    OptionListView(
                        title: L.t("Aos 40-40"),
                        options: DeuceMode.allCases.map { Option(value: $0, label: $0.title) },
                        selected: shownDeuceMode,
                        help: { _ in L.t("Vale a partir do próximo jogo.") },
                        onPick: { model.setNextDeuceMode($0) }
                    )
                    .subscreen(model)
                } label: {
                    menuRow(
                        shownDeuceMode.title,
                        match.nextDeuceMode == nil ? L.t("Aos 40-40") : L.t("Aos 40-40 · a partir do próximo jogo")
                    )
                }
                }
                NavigationLink {
                    HistoryView().subscreen(model)
                } label: {
                    menuRow(L.t("Últimos jogos"))
                }
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
                .padding(.top, 4)
                Text(L.t("Mantém o dedo para terminar"))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
            }
            .buttonStyle(.plain)
        }
        .navigationTitle(match.config.format.shortTitle)
        .navigationDestination(isPresented: $confirmEnd) {
            ConfirmEndView().subscreen(model)
        }
    }

    /// «6-4 · 3-2 · 30-15»; nos Pontos «Jogos 5-3 · 30-15»; no tie-break os pontos.
    private var liveLine: String {
        let d = match.display
        let points = "\(Labels.mark(d.us))-\(Labels.mark(d.them))"
        if match.phase == .points && match.pointsScoring == .rally { return match.setsLine }
        if match.phase == .points { return L.t("Jogos \(match.games[0])-\(match.games[1])") + " · " + points }  // Set sem fim
        return match.setsLine + " · " + points
    }

    private func menuRow(_ title: String, _ caption: String? = nil) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 16, weight: .bold))
                if let caption {
                    Text(caption).font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(Theme.muted)
        }
        .listCard()
    }
}

/// «Mudar quem serve»: Nós · eu, Nós · o meu parceiro, Eles.
enum ServeChoice: Hashable, CaseIterable {
    case usMe, usPartner, them

    init(_ m: MatchState) {
        switch (m.server, m.ourServer) {
        case (.them?, _): self = .them
        case (_, .partner?): self = .usPartner
        default: self = .usMe
        }
    }

    var team: Team { self == .them ? .them : .us }
    var player: Player? { self == .usMe ? .me : self == .usPartner ? .partner : nil }

    var label: String {
        switch self {
        case .usMe: L.t("Nós · eu")
        case .usPartner: L.t("Nós · o meu parceiro")
        case .them: L.t("Eles")
        }
    }
}

extension View {
    /// Ecrã aberto por cima do menu: enquanto está aberto não se volta sozinho ao marcador.
    func subscreen(_ model: AppModel) -> some View {
        onAppear { model.inSubscreen = true }
            .onDisappear { model.inSubscreen = false }
    }
}
#endif
