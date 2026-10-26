#if os(watchOS)
import AlinhoSync
import PadelScoring
import SwiftUI

/// «Jogos do mix»: os jogos do mix a decorrer em que estou, um por linha.
struct MixGamesView: View {
    @EnvironmentObject private var mix: MixModel

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                switch mix.state {
                case .signedOut:
                    message(L.t("Abre o alinho no iPhone para ligar o relógio."))
                case .failed:
                    message(L.t("Sem ligação. Tenta outra vez."))
                    Button(L.t("Tentar outra vez")) { mix.refresh() }
                        .buttonStyle(OutlineButtonStyle())
                        .padding(.top, 4)
                case .loading where mix.matches.isEmpty:
                    ProgressView().padding(.top, 12)
                default:
                    if mix.matches.isEmpty {
                        message(L.t("Sem jogos do mix a decorrer."))
                    }
                    ForEach(mix.matches) { m in
                        NavigationLink {
                            MixMatchView(initial: m)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(MixText.title(m)).font(.system(size: 16, weight: .bold))
                                Text(MixText.pairs(m))
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .listCard()
                        }
                    }
                }
            }
            .buttonStyle(.plain)
        }
        .navigationTitle(L.t("Jogos do mix"))
        .task { mix.refresh() }
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundStyle(Theme.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
    }
}

/// Um jogo do mix: o formato, as duplas e «Começar» (se o relógio souber
/// contar este jogo e ninguém o tiver começado).
struct MixMatchView: View {
    let initial: MixMatch

    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var mix: MixModel
    @State private var busy = false
    @State private var failed = false
    /// O `claim` disse `taken`: outro dos quatro já está a contar.
    @State private var taken = false

    /// A versão mais recente do jogo (a lista pode ter recarregado).
    private var m: MixMatch { mix.matches.first { $0.id == initial.id } ?? initial }

    private var config: MatchConfig? {
        MixRules.config(gameFormat: m.format, scoringFormat: m.scoringFormat, deuceMode: m.deuceMode, tiebreak88: m.tiebreak88)
    }

    /// Outro dos quatro está a contar.
    private var otherScorer: Bool {
        if taken { return true }
        guard let scorer = m.scorerID else { return false }
        return scorer != mix.userID
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Text(MixText.title(m))
                    .font(.system(size: 17, weight: .heavy))
                    .multilineTextAlignment(.center)
                if let config {
                    Text(config.format.title)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.lime)
                }
                VStack(spacing: 2) {
                    Text(L.t("Tu e \(shortName(m.partnerName))"))
                        .font(.system(size: 15, weight: .bold))
                    Text(L.t("contra \(MixText.opponents(m))"))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                }
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 4)

                if config == nil {
                    note(L.t("Este mix não dá para contar no relógio."))
                } else if otherScorer {
                    note(scorerText)
                } else {
                    Button(L.t("Começar")) { start() }
                        .buttonStyle(LimeButtonStyle())
                        .disabled(busy)
                        .opacity(busy ? 0.5 : 1)
                        .padding(.top, 4)
                    if failed {
                        note(L.t("Não deu para começar. Tenta outra vez."))
                    }
                }
            }
        }
        .navigationTitle(L.t("Jogos do mix"))
    }

    private var scorerText: String {
        let name = shortName(m.scorerName ?? "")
        guard !name.isEmpty else { return L.t("A ser contado por outra pessoa.") }
        return L.t("A ser contado por \(name).")
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(Theme.muted)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 4)
    }

    private func start() {
        guard !busy, let config else { return }
        busy = true
        failed = false
        let match = m
        Task {
            defer { busy = false }
            do {
                let claim = try await mix.claim(match)
                model.start(mix: match, config: config, side: claim.mySide)
            } catch SyncError.server("taken") {
                taken = true
                await mix.reload()
            } catch {
                failed = true
            }
        }
    }
}
#endif
