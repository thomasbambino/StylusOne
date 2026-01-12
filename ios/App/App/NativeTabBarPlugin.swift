import Foundation
import Capacitor
import UIKit

@objc(NativeTabBarPlugin)
public class NativeTabBarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeTabBarPlugin"
    public let jsName = "NativeTabBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSelectedTab", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateBadge", returnType: CAPPluginReturnPromise)
    ]

    private var tabBar: UITabBar?
    private var isVisible = false
    private var targetVisible = false  // Track desired state to avoid race conditions
    private var bottomConstraint: NSLayoutConstraint?

    // Navigation tabs
    private let tabMapping: [(id: String, icon: String, selectedIcon: String, title: String)] = [
        ("home", "house", "house.fill", "Home"),
        ("nowplaying", "play.rectangle", "play.rectangle.fill", "Now Playing"),
        ("guide", "square.grid.2x2", "square.grid.2x2.fill", "Guide"),
        ("profile", "person.circle", "person.circle.fill", "My Profile")
    ]

    @objc func show(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            // Set target state immediately
            self.targetVisible = true

            if self.tabBar == nil {
                self.createTabBar()
            }

            guard let tabBar = self.tabBar else {
                call.reject("Failed to create tab bar")
                return
            }

            // Cancel any ongoing animations
            tabBar.layer.removeAllAnimations()

            tabBar.isHidden = false
            self.isVisible = true

            // Animate in
            UIView.animate(withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.8, initialSpringVelocity: 0.5) {
                self.bottomConstraint?.constant = 0
                tabBar.superview?.layoutIfNeeded()
                tabBar.alpha = 1
            }

            call.resolve(["visible": true])
        }
    }

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let tabBar = self.tabBar else {
                call.resolve(["visible": false])
                return
            }

            // Set target state immediately
            self.targetVisible = false

            // Cancel any ongoing animations
            tabBar.layer.removeAllAnimations()

            UIView.animate(withDuration: 0.25, animations: {
                self.bottomConstraint?.constant = 100
                tabBar.superview?.layoutIfNeeded()
                tabBar.alpha = 0
            }) { [weak self] _ in
                // Only hide if we still want it hidden (prevents race condition)
                guard let self = self else { return }
                if !self.targetVisible {
                    tabBar.isHidden = true
                    self.isVisible = false
                }
            }

            call.resolve(["visible": false])
        }
    }

    @objc func setSelectedTab(_ call: CAPPluginCall) {
        guard let tabId = call.getString("tabId") else {
            call.reject("tabId is required")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let tabBar = self.tabBar else {
                call.resolve()
                return
            }

            if let index = self.tabMapping.firstIndex(where: { $0.id == tabId }),
               let items = tabBar.items, index < items.count {
                tabBar.selectedItem = items[index]
            }

            call.resolve()
        }
    }

    @objc func updateBadge(_ call: CAPPluginCall) {
        guard let tabId = call.getString("tabId") else {
            call.resolve()
            return
        }

        let value = call.getInt("value")

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let tabBar = self.tabBar else {
                call.resolve()
                return
            }

            if let index = self.tabMapping.firstIndex(where: { $0.id == tabId }),
               let items = tabBar.items, index < items.count {
                if let badgeValue = value, badgeValue > 0 {
                    items[index].badgeValue = "\(badgeValue)"
                } else {
                    items[index].badgeValue = nil
                }
            }

            call.resolve()
        }
    }

    private func createTabBar() {
        guard let viewController = self.bridge?.viewController else { return }

        let tabBar = UITabBar()
        tabBar.delegate = self
        tabBar.translatesAutoresizingMaskIntoConstraints = false

        // Make tab bar translucent so content can scroll underneath
        tabBar.clipsToBounds = false
        tabBar.isTranslucent = true
        tabBar.isOpaque = false

        // Start completely invisible - off-screen and hidden
        tabBar.alpha = 0
        tabBar.isHidden = true

        // Configure appearance for iOS 15+ with translucent dark background
        if #available(iOS 15.0, *) {
            let appearance = UITabBarAppearance()
            appearance.configureWithTransparentBackground()
            appearance.backgroundColor = UIColor.black.withAlphaComponent(0.85)
            appearance.backgroundEffect = UIBlurEffect(style: .dark)
            appearance.shadowColor = .clear
            appearance.shadowImage = UIImage()

            // Configure item appearance for dark theme
            let itemAppearance = UITabBarItemAppearance()
            itemAppearance.normal.iconColor = UIColor.white.withAlphaComponent(0.6)
            itemAppearance.normal.titleTextAttributes = [.foregroundColor: UIColor.white.withAlphaComponent(0.6)]
            itemAppearance.selected.iconColor = .white
            itemAppearance.selected.titleTextAttributes = [.foregroundColor: UIColor.white]

            appearance.stackedLayoutAppearance = itemAppearance
            appearance.inlineLayoutAppearance = itemAppearance
            appearance.compactInlineLayoutAppearance = itemAppearance

            tabBar.standardAppearance = appearance
            tabBar.scrollEdgeAppearance = appearance
        }

        // Set tint colors
        tabBar.tintColor = .white
        tabBar.unselectedItemTintColor = UIColor.white.withAlphaComponent(0.6)

        // Create tab bar items AFTER appearance is configured
        var items: [UITabBarItem] = []
        for (index, tab) in tabMapping.enumerated() {
            let item = UITabBarItem(
                title: tab.title,
                image: UIImage(systemName: tab.icon),
                selectedImage: UIImage(systemName: tab.selectedIcon)
            )
            item.tag = index
            items.append(item)
        }
        tabBar.setItems(items, animated: false)
        // Default to "Now Playing" tab (index 1) since app launches to player
        tabBar.selectedItem = items.count > 1 ? items[1] : items.first

        viewController.view.addSubview(tabBar)

        // Position at the bottom of the screen, starting off-screen
        let bottomConstraint = tabBar.bottomAnchor.constraint(equalTo: viewController.view.bottomAnchor, constant: 100)

        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: viewController.view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: viewController.view.trailingAnchor),
            bottomConstraint
        ])

        self.tabBar = tabBar
        self.bottomConstraint = bottomConstraint
    }
}

// MARK: - UITabBarDelegate
extension NativeTabBarPlugin: UITabBarDelegate {
    public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        // Haptic feedback
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()

        // Get the tab id from the tag
        let index = item.tag
        if index < tabMapping.count {
            let tabId = tabMapping[index].id
            notifyListeners("tabSelected", data: ["tabId": tabId])
        }
    }
}
