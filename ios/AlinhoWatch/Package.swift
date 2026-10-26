// swift-tools-version: 5.10
// Marcador do Apple Watch. PadelScoring tem as regras e testa-se em macOS com
// `swift test`; ScoreboardUI tem os ecrãs e só compila de facto em watchOS
// (o código está dentro de `#if os(watchOS)`). AlinhoSync fala com o Supabase
// (jogos do mix e fila do resultado) e também se testa em macOS. Ver
// docs/superpowers/specs/2026-10-22-apple-watch-marcador-fase1-design.md.
import PackageDescription

let package = Package(
    name: "AlinhoWatch",
    defaultLocalization: "pt-PT",
    platforms: [.watchOS(.v10), .macOS(.v14)],
    products: [
        .library(name: "PadelScoring", targets: ["PadelScoring"]),
        .library(name: "ScoreboardUI", targets: ["ScoreboardUI"]),
    ],
    targets: [
        .target(name: "PadelScoring"),
        .target(name: "AlinhoSync", dependencies: ["PadelScoring"]),
        .target(
            name: "ScoreboardUI",
            dependencies: ["PadelScoring", "AlinhoSync"],
            resources: [.process("Resources")]
        ),
        .testTarget(name: "PadelScoringTests", dependencies: ["PadelScoring"]),
        .testTarget(name: "AlinhoSyncTests", dependencies: ["AlinhoSync", "PadelScoring"]),
    ]
)
