#if os(watchOS)
import PadelScoring
import SwiftUI

/// «Novo jogo» (protótipo de 23 out): as linhas com a última escolha, «Começar» e
/// «Últimos jogos». No jogo seguinte é só «Começar».
struct SetupView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var mix: MixModel
    /// Escolher «Nós» em «Quem serve» abre logo «Na nossa dupla».
    @State private var askOurFirst = false

    private var config: MatchConfig { model.session.config }
    private var isPoints: Bool { config.format == .points }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 6) {
                    NavigationLink {
                        OptionListView(
                            title: L.t("Formato"),
                            options: MatchFormat.allCases.map { Option(value: $0, label: $0.title) },
                            selected: config.format,
                            onPick: update { c, v in c.format = v }
                        )
                    } label: {
                        row(config.format.title, L.t("Formato"))
                    }
                    if isPoints {
                        NavigationLink {
                            OptionListView(
                                title: L.t("Total da ronda"),
                                options: MatchConfig.pointsTotalOptions.map { Option(value: $0, label: Labels.pointsTotal($0)) },
                                selected: config.pointsTotal,
                                onPick: update { c, v in c.pointsTotal = v }
                            )
                        } label: {
                            row(totalLine, L.t("Total da ronda"))
                        }
                    }
                    if !isPoints {
                    NavigationLink {
                        OptionListView(
                            title: L.t("Aos 40-40"),
                            options: DeuceMode.allCases.map { Option(value: $0, label: $0.title) },
                            selected: config.deuceMode,
                            help: { $0.help },
                            onPick: update { c, v in c.deuceMode = v }
                        )
                    } label: {
                        row(config.deuceMode.title, L.t("Aos 40-40"))
                    }
                    NavigationLink {
                        OptionListView(
                            title: L.t("Quem serve primeiro"),
                            options: [nil, Team.us, Team.them].map { Option(value: $0, label: Labels.server($0)) },
                            selected: config.firstServer,
                            help: { _ in L.t("Se escolheres, o relógio mostra quem serve e de que lado.") },
                            onPick: { (v: Team?) in
                                update { c, v in c.firstServer = v }(v)
                                if v == .us { askOurFirstAfterDismiss() }
                            }
                        )
                    } label: {
                        row(Labels.server(config.firstServer), L.t("Quem serve"))
                    }
                    }
                    if !isPoints && config.firstServer == .us {
                        NavigationLink {
                            ourFirstList
                        } label: {
                            row(Labels.player(config.ourFirstServer), L.t("Na nossa dupla, serve primeiro"))
                        }
                    }
                    NavigationLink {
                        OptionListView(
                            title: L.t("Marcador"),
                            options: ScoreLayout.allCases.map { Option(value: $0, label: Labels.layout($0)) },
                            selected: config.layout,
                            help: { _ in L.t("Muda só a arrumação. As regras e as cores ficam iguais.") },
                            onPick: update { c, v in c.layout = v }
                        )
                    } label: {
                        HStack(spacing: 10) {
                            LayoutIcon(layout: config.layout)
                            row(Labels.layout(config.layout), L.t("Marcador"), card: false)
                        }
                        .padding(.leading, 12)
                        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.listBg))
                    }
                    if mix.showsEntry {
                        NavigationLink {
                            MixGamesView()
                        } label: {
                            Text(L.t("Jogos do mix"))
                        }
                        .buttonStyle(OutlineButtonStyle())
                        .padding(.top, 4)
                    }
                    Button(L.t("Começar")) { model.start() }
                        .buttonStyle(LimeButtonStyle())
                        .padding(.top, 4)
                    NavigationLink {
                        HistoryView()
                    } label: {
                        HStack {
                            Text(L.t("Últimos jogos")).font(.system(size: 16, weight: .bold))
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(Theme.muted)
                        }
                        .listCard()
                    }
                    .padding(.top, 8)
                }
                // As linhas são cartões nossos; sem isto o watchOS põe-lhes o fundo de botão por cima.
                .buttonStyle(.plain)
            }
            .navigationTitle(L.t("Novo jogo"))
            .task { mix.setupAppeared() }
            .navigationDestination(isPresented: $askOurFirst) { ourFirstList }
        }
    }

    private var ourFirstList: some View {
        OptionListView(
            title: L.t("Na nossa dupla"),
            options: Player.allCases.map { Option(value: $0, label: Labels.player($0)) },
            selected: config.ourFirstServer,
            help: { _ in L.t("Com isto, o relógio diz quem serve e de que lado.") },
            onPick: update { c, v in c.ourFirstServer = v }
        )
    }

    /// A lista de «Quem serve» fecha-se sozinha; só depois se abre a seguinte.
    private func askOurFirstAfterDismiss() {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(450))
            askOurFirst = true
        }
    }

    private var totalLine: String {
        guard let total = config.pointsTotal else { return L.t("Sem total") }
        return L.t("Total: \(total) pontos")
    }

    /// Devolve um `onPick` que altera um campo da configuração e grava.
    private func update<V>(_ change: @escaping (inout MatchConfig, V) -> Void) -> (V) -> Void {
        { value in
            var c = model.session.config
            change(&c, value)
            model.setConfig(c)
        }
    }

    @ViewBuilder
    private func row(_ value: String, _ caption: String, card: Bool = true) -> some View {
        let content = VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
            Text(caption).font(.system(size: 12)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, card ? 12 : 0)
        .padding(.vertical, 8)
        if card {
            content.background(RoundedRectangle(cornerRadius: 14).fill(Theme.listBg))
        } else {
            content
        }
    }
}

/// Desenho pequeno dos dois blocos: lado a lado ou um por cima do outro.
struct LayoutIcon: View {
    let layout: ScoreLayout

    var body: some View {
        Group {
            if layout == .side {
                HStack(spacing: 2) { block(Theme.lime); block(Theme.themGrey) }
            } else {
                VStack(spacing: 2) { block(Theme.themGrey); block(Theme.lime) }
            }
        }
        .frame(width: 18, height: 18)
    }

    private func block(_ color: Color) -> some View {
        RoundedRectangle(cornerRadius: 2).fill(color)
    }
}

/// Botão lima a toda a largura («Começar», «Novo jogo»).
struct LimeButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.number(17))
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(Capsule().fill(Theme.lime))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}
#endif
