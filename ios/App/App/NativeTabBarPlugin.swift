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
        CAPPluginMethod(name: "updateBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTabs", returnType: CAPPluginReturnPromise)
    ]

    private var tabBar: UITabBar?
    private var isVisible = false
    private var targetVisible = false  // Track desired state to avoid race conditions
    private var bottomConstraint: NSLayoutConstraint?

    // All available tabs with their configuration
    private let allTabs: [(id: String, icon: String, selectedIcon: String, title: String)] = [
        ("home", "house", "house.fill", "Home"),
        ("nowplaying", "play.rectangle", "play.rectangle.fill", "Now Playing"),
        ("events", "sportscourt", "sportscourt.fill", "Events"),
        ("guide", "square.grid.2x2", "square.grid.2x2.fill", "Guide"),
        ("profile", "person.circle", "person.circle.fill", "My Profile")
    ]

    // Currently visible tabs (can be updated via setTabs)
    private var visibleTabIds: [String] = ["home", "nowplaying", "events", "guide", "profile"]

    // Computed property to get only the visible tabs in order
    private var visibleTabs: [(id: String, icon: String, selectedIcon: String, title: String)] {
        return visibleTabIds.compactMap { tabId in
            allTabs.first { $0.id == tabId }
        }
    }

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

            if let index = self.visibleTabs.firstIndex(where: { $0.id == tabId }),
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

            if let index = self.visibleTabs.firstIndex(where: { $0.id == tabId }),
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

    @objc func setTabs(_ call: CAPPluginCall) {
        guard let tabIds = call.getArray("tabs", String.self) else {
            call.reject("tabs array is required")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            // Update visible tabs
            self.visibleTabIds = tabIds

            // If tab bar exists, rebuild the items
            if let tabBar = self.tabBar {
                var items: [UITabBarItem] = []
                for (index, tab) in self.visibleTabs.enumerated() {
                    let item = UITabBarItem(
                        title: tab.title,
                        image: UIImage(systemName: tab.icon),
                        selectedImage: UIImage(systemName: tab.selectedIcon)
                    )
                    item.tag = index
                    items.append(item)
                }
                tabBar.setItems(items, animated: true)
                // Select first tab by default if nothing selected
                if tabBar.selectedItem == nil && !items.isEmpty {
                    tabBar.selectedItem = items.first
                }
            }

            call.resolve(["tabs": tabIds])
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

        // Check if iPad for custom sizing
        let isIPad = UIDevice.current.userInterfaceIdiom == .pad

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
            itemAppearance.selected.iconColor = .white

            if isIPad {
                // iPad: Custom font sizing
                itemAppearance.normal.titleTextAttributes = [
                    .foregroundColor: UIColor.white.withAlphaComponent(0.6),
                    .font: UIFont.systemFont(ofSize: 11, weight: .medium)
                ]
                itemAppearance.selected.titleTextAttributes = [
                    .foregroundColor: UIColor.white,
                    .font: UIFont.systemFont(ofSize: 11, weight: .semibold)
                ]
            } else {
                // iPhone: Use default system font (original behavior)
                itemAppearance.normal.titleTextAttributes = [.foregroundColor: UIColor.white.withAlphaComponent(0.6)]
                itemAppearance.selected.titleTextAttributes = [.foregroundColor: UIColor.white]
            }

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
        for (index, tab) in visibleTabs.enumerated() {
            let item: UITabBarItem
            if isIPad {
                // iPad: Use custom icon sizing (20pt)
                let iconConfig = UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)
                item = UITabBarItem(
                    title: tab.title,
                    image: UIImage(systemName: tab.icon, withConfiguration: iconConfig),
                    selectedImage: UIImage(systemName: tab.selectedIcon, withConfiguration: iconConfig)
                )
            } else {
                // iPhone: Use default system icons (original behavior)
                item = UITabBarItem(
                    title: tab.title,
                    image: UIImage(systemName: tab.icon),
                    selectedImage: UIImage(systemName: tab.selectedIcon)
                )
            }
            item.tag = index
            items.append(item)
        }
        tabBar.setItems(items, animated: false)
        tabBar.selectedItem = items.first  // Default to Home tab

        viewController.view.addSubview(tabBar)

        // Position at the bottom of the screen, starting off-screen
        let bottomConstraint = tabBar.bottomAnchor.constraint(equalTo: viewController.view.bottomAnchor, constant: 100)

        var constraints = [
            tabBar.leadingAnchor.constraint(equalTo: viewController.view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: viewController.view.trailingAnchor),
            bottomConstraint
        ]

        // Add explicit height for iPad (65pt vs system default 49pt)
        if isIPad {
            constraints.append(tabBar.heightAnchor.constraint(equalToConstant: 65))
        }

        NSLayoutConstraint.activate(constraints)

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
        if index < visibleTabs.count {
            let tabId = visibleTabs[index].id
            notifyListeners("tabSelected", data: ["tabId": tabId])
        }
    }
}
