// Views/Components/ConfirmDialog.swift
import SwiftUI

/// Reusable confirmation dialog using SwiftUI's `.alert()` modifier pattern.
/// Apply as a view modifier via `.confirmDialog(...)`.
struct ConfirmDialog: ViewModifier {
    @Binding var isPresented: Bool
    let title: String
    let message: String
    let confirmLabel: String
    let onConfirm: () -> Void

    func body(content: Content) -> some View {
        content
            .alert(title, isPresented: $isPresented) {
                Button(confirmLabel, role: .destructive) {
                    onConfirm()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(message)
            }
    }
}

extension View {
    /// Attaches a reusable destructive confirmation alert to a view.
    ///
    /// - Parameters:
    ///   - isPresented: Binding that controls alert visibility.
    ///   - title: Alert title text.
    ///   - message: Alert body message.
    ///   - confirmLabel: Label for the destructive confirm button.
    ///   - onConfirm: Closure called when the user taps confirm.
    func confirmDialog(
        isPresented: Binding<Bool>,
        title: String,
        message: String,
        confirmLabel: String = "Confirm",
        onConfirm: @escaping () -> Void
    ) -> some View {
        modifier(ConfirmDialog(
            isPresented: isPresented,
            title: title,
            message: message,
            confirmLabel: confirmLabel,
            onConfirm: onConfirm
        ))
    }
}
