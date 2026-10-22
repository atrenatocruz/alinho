#if os(watchOS)
import PadelScoring
import SwiftUI

/// «Novo jogo» (PDF p. 5, «Abrir e começar»): três linhas com a última escolha e
/// «Começar». No jogo seguinte é só «Começar».
struct SetupView: View {
    @EnvironmentObject private var model: AppModel

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
                    } else {
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
                                help: { _ in L.t("Se escolheres, o relógio mostra quem serve em cada jogo.") },
                                onPick: update { c, v in c.firstServer = v }
                            )
                        } label: {
                            row(Labels.server(config.firstServer), L.t("Quem serve"))
                        }
                    }
                    Button(L.t("Começar")) { model.start() }
                        .buttonStyle(LimeButtonStyle())
                        .padding(.top, 4)
                }
                // As linhas são cartões nossos; sem isto o watchOS põe-lhes o fundo de botão por cima.
                .buttonStyle(.plain)
            }
            .navigationTitle(L.t("Novo jogo"))
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

    private func row(_ value: String, _ caption: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
            Text(caption).font(.system(size: 12)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.listBg))
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
