#if os(watchOS)
import PadelScoring
import SwiftUI

/// «Acertar o marcador»: jogos e pontos de Nós e Eles. Toca-se num número e
/// roda-se a coroa; «Guardar» acerta (e o «Desfazer» volta ao que estava).
struct CorrectScoreView: View {
    let match: MatchState

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var games: [Int]
    @State private var points: [Int]
    @State private var selected = Cell(row: .points, team: .us)
    @State private var crown = 0.0

    struct Cell: Equatable {
        enum Row { case games, points }
        let row: Row
        let team: Team
    }

    init(match: MatchState) {
        self.match = match
        _games = State(initialValue: match.games)
        _points = State(initialValue: match.points)
    }

    /// Tie-break e super tie-break contam pontos; o resto 0, 15, 30, 40, Vant.
    private var countsRawPoints: Bool { match.phase == .tieBreak || match.phase == .superTieBreak }

    var body: some View {
        VStack(spacing: 6) {
            Grid(horizontalSpacing: 6, verticalSpacing: 6) {
                GridRow {
                    Color.clear.frame(width: 1, height: 1)
                    header(L.t("Nós"))
                    header(L.t("Eles"))
                }
                GridRow {
                    rowTitle(L.t("Jogos"))
                    cell(.init(row: .games, team: .us), "\(games[0])")
                    cell(.init(row: .games, team: .them), "\(games[1])")
                }
                GridRow {
                    rowTitle(L.t("Pontos"))
                    cell(.init(row: .points, team: .us), pointText(0))
                    cell(.init(row: .points, team: .them), pointText(1))
                }
            }
            Text(L.t("Toca num número e roda a coroa."))
                .font(.system(size: 12))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
            Button(L.t("Guardar")) {
                model.correct(games: games, points: points)
                dismiss()
            }
            .buttonStyle(LimeButtonStyle())
        }
        .navigationTitle(L.t("Acertar"))
        .focusable()
        .digitalCrownRotation($crown, from: -1000, through: 1000, by: 1, sensitivity: .low, isContinuous: true)
        .onChange(of: crown) { old, new in
            let step = Int(new.rounded()) - Int(old.rounded())
            if step != 0 { bump(step) }
        }
    }

    private func pointText(_ i: Int) -> String {
        if countsRawPoints { return "\(points[i])" }
        let a = points[i], b = points[1 - i]
        if a >= 3 && b >= 3 { return a > b ? L.t("Vant.") : "40" }
        return ["0", "15", "30", "40"][min(a, 3)]
    }

    /// Nos Pontos a ronda vai até ao total (cada lado fica abaixo dele); nos sets, 12.
    private var gamesTop: Int {
        guard match.phase == .points else { return 12 }
        return match.config.pointsTotal.map { max(0, $0 - 1) } ?? 999
    }

    /// Os mesmos limites do pacote (`Scoring.correct`), para a grelha nunca mostrar
    /// um marcador que não se pode guardar.
    private func bump(_ step: Int) {
        let i = selected.team.rawValue, o = 1 - i
        switch selected.row {
        case .games:
            games[i] = min(gamesTop, max(0, games[i] + step))
        case .points:
            let top = countsRawPoints ? 40 : 4
            points[i] = min(top, max(0, points[i] + step))
            guard !countsRawPoints else { return }
            if points[i] == 4 && points[o] < 3 { points[i] = 3 }
            if points[i] == 4 && points[o] > 3 { points[o] = 3 }
        }
    }

    private func header(_ text: String) -> some View {
        Text(text).font(.system(size: 11, weight: .heavy)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity)
    }

    private func rowTitle(_ text: String) -> some View {
        Text(text).font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.muted)
    }

    private func cell(_ c: Cell, _ text: String) -> some View {
        let isUs = c.team == .us
        return Button { selected = c } label: {
            Text(text)
                .font(Theme.number(text.count > 3 ? 16 : 22))
                .foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity, minHeight: 36)
                .background(RoundedRectangle(cornerRadius: 10).fill(isUs ? Theme.lime : Theme.themGrey))
                .overlay {
                    RoundedRectangle(cornerRadius: 10).strokeBorder(.white, lineWidth: selected == c ? 3 : 0)
                }
        }
        .buttonStyle(.plain)
    }
}

/// «Terminar o jogo?» depois do dedo pousado no menu.
struct ConfirmEndView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L.t("Terminar o jogo?")).font(.system(size: 18, weight: .heavy))
            Text(L.t("Contam os sets e os jogos fechados. O jogo a meio não conta."))
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
            Spacer(minLength: 0)
            Button(L.t("Terminar")) { model.stop() }
                .buttonStyle(FilledButtonStyle(fill: Theme.red, ink: Theme.ink))
            Button(L.t("Cancelar")) { dismiss() }
                .buttonStyle(OutlineButtonStyle())
        }
    }
}

/// «Ainda estão a jogar?» ao fim de 20 minutos sem pontos.
struct IdleView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L.t("Ainda estão a jogar?")).font(.system(size: 18, weight: .heavy))
            Text(L.t("Não há pontos há 20 minutos."))
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
            Spacer(minLength: 0)
            Button(L.t("Continuar")) { model.keepPlaying() }
                .buttonStyle(LimeButtonStyle())
            Button(L.t("Terminar o jogo")) { model.stopFromIdle() }
                .buttonStyle(OutlineButtonStyle())
        }
        .padding(.horizontal, 4)
    }
}

struct FilledButtonStyle: ButtonStyle {
    let fill: Color
    let ink: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.number(16))
            .foregroundStyle(ink)
            .frame(maxWidth: .infinity, minHeight: 38)
            .background(Capsule().fill(fill))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

struct OutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.number(16))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 38)
            .overlay(Capsule().strokeBorder(.white, lineWidth: 1.5))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}
#endif
