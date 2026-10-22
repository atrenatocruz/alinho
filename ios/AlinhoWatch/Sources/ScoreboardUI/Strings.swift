#if os(watchOS)
import Foundation

/// Textos do relógio: a chave é o texto em português (Localizable.xcstrings).
enum L {
    static func t(_ key: String.LocalizationValue) -> String {
        String(localized: key, bundle: .module)
    }
}
#endif
