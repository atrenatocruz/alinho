#if os(watchOS)
import PadelScoring
import SwiftUI

/// O marcador (protótipo de 23 out): em cima a pílula «↺ Desfazer» e a hora; por
/// baixo o estado e os minutos de jogo; os blocos «NÓS» e «ELES» lado a lado ou um
/// por cima do outro. Com o pulso em baixo escurece e fica só o resultado.
struct ScoreboardView: View {
    let match: MatchState

    @EnvironmentObject private var model: AppModel
    @Environment(\.isLuminanceReduced) private var dim

    private var stacked: Bool { match.config.layout == .stack }

    var body: some View {
        let display = match.display
        let serve = match.serveInfo
        VStack(spacing: 4) {
            statusRow
            Group {
                if stacked {
                    VStack(spacing: 6) {
                        block(.them, display.them, serve)
                        block(.us, display.us, serve)
                    }
                } else {
                    HStack(spacing: 6) {
                        block(.us, display.us, serve)
                        block(.them, display.them, serve)
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if !dim { undoPill }
            }
        }
        .onChange(of: dim) { _, isDim in
            if !isDim { model.wokeAt = Date() }
        }
    }

    private var undoPill: some View {
        HoldButton(
            target: .undo,
            fillFromBottom: false,
            fillColor: .white.opacity(0.22),
            cornerRadius: 14,
            disabled: !model.session.canUndo,
            onComplete: model.undo
        ) {
            Text("↺ " + L.t("Desfazer"))
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .frame(minHeight: 28)
                .overlay(Capsule().strokeBorder(.white, lineWidth: 1.5))
        }
        .opacity(model.session.canUndo ? 1 : 0.35)
    }

    /// O estado (ou os sets e jogos) e, à direita, os minutos de jogo sem pausas.
    private var statusRow: some View {
        HStack(alignment: .firstTextBaseline) {
            statusText
            Spacer(minLength: 4)
            TimelineView(.periodic(from: .now, by: 20)) { context in
                Text(minutesText(match.elapsed(at: context.date)))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
        }
        .lineLimit(1)
        .opacity(dim ? 0.6 : 1)
        .padding(.horizontal, 2)
    }

    @ViewBuilder
    private var statusText: some View {
        switch match.statusLine {
        case .paused?:
            Text(L.t("Em pausa")).font(.system(size: 15, weight: .heavy)).foregroundStyle(Theme.amber)
        case let status? where !Self.isPlain(status):
            Text(Labels.status(status)).font(.system(size: 15, weight: .heavy)).foregroundStyle(Theme.lime)
        case let status?:
            Text(Labels.status(status)).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.topLine)
        case nil:
            Text(match.setsLine)
                .font(.system(size: 14, weight: .bold, design: .monospaced))
                .foregroundStyle(Theme.topLine)
        }
    }

    /// Estados que são só informação (a ronda dos Pontos), sem destaque a lima.
    private static func isPlain(_ s: StatusLabel) -> Bool {
        switch s {
        case .gamesRound, .points: true
        default: false
        }
    }

    private func block(_ team: Team, _ mark: PointMark, _ serve: ServeInfo?) -> some View {
        let text = Labels.mark(mark)
        let background = team == .us ? (dim ? Theme.dimLime : Theme.lime) : (dim ? Theme.dimGrey : Theme.themGrey)
        let ink = dim ? Theme.dimText : Theme.ink
        let serving = match.server == team
        let who = Labels.serve(team, serve)
        let name = Text(team == .us ? L.t("Nós") : L.t("Eles"))
            .font(.system(size: 11, weight: .heavy))
            .textCase(.uppercase)
            .tracking(0.6)
        return HoldButton(target: .block(team), fillFromBottom: !stacked, onComplete: { model.point(team) }) {
            ZStack {
                background
                if stacked {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                name
                                if serving { Circle().fill(ink).frame(width: 8, height: 8) }
                            }
                            if let who { Text(who).font(.system(size: 11, weight: .semibold)) }
                        }
                        Spacer()
                        number(text, team)
                    }
                    .padding(.horizontal, 10)
                } else {
                    VStack(spacing: 2) {
                        name.padding(.top, 8)
                        Spacer()
                        if serving {
                            Circle().fill(ink).frame(width: 10, height: 10)
                            if let who {
                                Text(who)
                                    .font(.system(size: 10, weight: .semibold))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.7)
                            }
                        }
                    }
                    .padding(.bottom, 8)
                    number(text, team)
                }
            }
            .foregroundStyle(ink)
            .overlay {
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(.white, lineWidth: model.flash == team ? 3 : 0)
            }
        }
        .accessibilityLabel(team == .us ? L.t("Nós") : L.t("Eles"))
        .accessibilityValue(text)
    }

    private func number(_ text: String, _ team: Team) -> some View {
        Text(text)
            .font(Theme.number(text.count > 3 ? 30 : (stacked ? 40 : 46)))
            .minimumScaleFactor(0.5)
            .lineLimit(1)
            .contentTransition(.numericText())
            .scaleEffect(model.flash == team ? 1.12 : 1)
            .animation(.spring(duration: 0.22), value: model.flash)
            .animation(.default, value: text)
            .padding(.horizontal, 4)
    }
}
#endif
