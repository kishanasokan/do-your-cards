# ⛔ Do Your Cards

**Stop doomscrolling. Start reviewing.** **Do Your Cards** is a Chrome extension designed to help users build consistent spaced repetition habits. It intercepts visits to distracting websites and prompts you to complete your daily flashcards before you are allowed to browse.

## ✨ Features

* **Custom Interception:** Add distracting websites (e.g., Reddit, Twitter, Instagram) to your personal blocklist.
* **Anti-Cheat Forced Block:** When a distracting site is intercepted, a mandatory countdown timer begins. The "I finished my cards" button remains disabled until the timer hits zero.
* **Reward-Based Browsing:** Set a custom "Unblock Time." Once you confirm you have completed your flashcards, you are granted a set window of browsing before the site automatically locks down again.
* **AnkiWeb Integration:** The block overlay features a direct link to AnkiWeb so you can review in your browser.
* **Daily Goal Tracking:** Set your target number of flashcards per session and monitor your daily block and completion statistics from the extension menu.

## 🔒 Privacy & Data

**Do Your Cards** operates entirely locally on your machine.
* **Local Storage:** All settings, blocked domains, and daily statistics are saved directly to your browser using the `chrome.storage.local` API.
* **No External Servers:** The extension does not track browsing history, collect personally identifiable information, or send data to external servers.

## 🚀 Installation

You can install the extension locally using Chrome's Developer Mode.

1. Clone or download this repository to your local machine.
2. If downloaded as a `.zip`, extract the folder.
3. Open Google Chrome and navigate to `chrome://extensions/`.
4. Toggle on **"Developer mode"** in the top right corner.
5. Click **"Load unpacked"** in the top left corner.
6. Select the extracted folder.
7. Pin the extension to your toolbar and click it to configure your settings.

## ⚙️ Usage

1. Click the extension icon in your toolbar to open the settings panel.
2. Enter the URLs of the websites you want to block and click **+ Add**.
3. Set your **Forced Block** time (the mandatory wait period before you can unlock a site).
4. Set your **Unblock Time** (how long you are allowed to browse *after* completing your cards).
5. Toggle **Open AnkiWeb on block** to display a quick-link on the lock screen.
6. Navigate to a blocked site and get to work!