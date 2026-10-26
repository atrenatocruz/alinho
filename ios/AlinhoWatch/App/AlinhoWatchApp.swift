import ScoreboardUI
import SwiftUI

// O código do relógio está todo no pacote (ios/AlinhoWatch/Sources/ScoreboardUI),
// para este alvo não precisar de mudar no project.pbxproj.
@main
struct AlinhoWatchApp: App {
    init() {
        Theme.registerFonts()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
