import { hashPassword } from "../server/auth";
import { storage } from "../server/storage";

async function createAdmin() {
  try {
    const username = "tommyshorez";
    const password = "test";

    // Check if user exists
    let user = await storage.getUserByUsername(username);
    const hashedPassword = await hashPassword(password);

    if (user) {
      // Update existing user
      user = await storage.updateUser({
        id: user.id,
        password: hashedPassword,
        role: "admin",
        approved: true,
        can_view_nsfw: false,
        show_uptime_log: false,
        show_service_url: true,
        show_refresh_interval: true,
        show_last_checked: true,
        service_order: [],
      });
      console.log("Updated existing user to admin:", user);
    } else {
      // Create new admin user
      user = await storage.createUser({
        username,
        password: hashedPassword,
        role: "admin",
        approved: true,
        can_view_nsfw: false,
        show_uptime_log: false,
        show_service_url: true,
        show_refresh_interval: true,
        show_last_checked: true,
        service_order: [],
      });
      console.log("Created admin user:", user);
    }
  } catch (error) {
    console.error("Error creating admin user:", error);
  }
}

createAdmin().catch(console.error);