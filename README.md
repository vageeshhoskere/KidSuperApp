# Kid 3D Builder

A block-building toy for a young child. The child types (or speaks, or taps picture buttons) what they want to build, an AI designs it out of simple blocks, and the child sees it in 3D. Every request and every answer is checked before the child sees anything, and you can read everything in the parent area.

## What you need

- A computer at home that stays on while the child plays (Windows, Mac or Linux)
- Node.js 22 or newer (https://nodejs.org)
- An API key from at least one AI company: OpenAI, Anthropic or Google. You create it on their website; it is billed to you.

## Install and start

Open a terminal in this folder and run:

```
npm install
npm run build
npm start
```

The program prints the addresses to use (one per network the computer is on). Leave the terminal open while the child plays: closing it stops the app.

The first time it starts, your computer may ask whether to allow incoming network connections for Node.js. Allow it for your private/home network, or the child's device cannot connect.

- Child's tablet or computer: open `http://<computer-ip>:3000` (use an address printed when you start it, for example `http://192.168.1.20:3000`). Both devices must be on your home Wi-Fi.
- Your area: open `http://<computer-ip>:3000/parent`.

First time at `/parent` a short wizard asks you to choose a 6-digit PIN, add the child's name and age, paste an API key and press Test, and pick the AI models. Then press **Test build**: it sends one fixed, harmless request ("a small red house") through the models you chose and says "Works! It built: ..." or which step failed. Do not let the child use the app until a Test build has passed with your real keys. The same button is under Settings (it uses the saved settings). Until the wizard is finished the child sees "Ask a grown-up to set me up!".

The app uses plain HTTP on your home network (there is no certificate), so it is meant for a home network you trust: anyone on the same Wi-Fi could in principle read the traffic, including the parent session.

## Settings you can change

Under Settings in the parent area. Defaults:

| Setting | Default |
|---|---|
| Typing / picture buttons | on |
| Voice input | off |
| Speech to text | browser (nothing leaves the device) |
| Spoken replies | off (browser voice if turned on) |
| When a request is flagged | redirect (suggest something else) |
| Picture check | on |
| Builds per day | 30 |
| Allowed hours | 08:00 to 19:00 (local time) |
| Keep audit log | 90 days |
| Moderation threshold | 0.2 (allowed 0.05 to 0.5; lower is stricter) |
| Email for "notify" | empty |

Only the child's own builds count towards "Builds per day"; builds that end in "Oops" (for example when a provider is down), Test builds and red-team runs do not.

You can also add your own blocked words and allowed phrases per child. A few ordinary phrases that contain a blocked word ("shooting star", "bomb pop", "pen is", "driveway") are always allowed. Flagged requests can be redirected, redirected with an email to you, or held until you approve them.

## What is checked

Everything the child asks goes through three layers, and a failure at any step means the child sees a friendly redirect and nothing the AI wrote:

1. A built-in word list (plus your extra words), and a scan that removes personal details such as phone numbers, emails and addresses.
2. A moderation service from OpenAI or Google (you can turn it off, but the wizard asks you to confirm).
3. A second AI "checker" that must say the request is clearly suitable; if it is unsure, it is blocked. With Anthropic models the checker cannot be pinned to temperature 0 (the API does not accept it), so its answers can vary a little from run to run; OpenAI and Google checkers run at temperature 0 (except OpenAI reasoning models, which do not accept it either).

The AI's design is then described in words and checked the same way. Only the building's title (1 to 5 plain words) is ever shown as AI text. Finally the **picture check** renders the finished building and has the checker look at the picture for rude shapes or symbols. If anything times out, errors or looks odd, the child sees "Oops, let's try again!".

## What leaves your house

- The child's typed text, and a text description of each building, is sent to the AI companies you chose (and, if moderation is on, to OpenAI or Google).
- The picture check sends a picture of the finished building to the checker's company.
- Audio is sent only if you switch speech to text or text to speech to a cloud provider. The default is the browser, which stays on the device. With cloud speech to text, the transcript is also checked by moderation and the checker before the child sees it.
- Personal details (phone numbers, emails, addresses) are masked before anything is saved or sent on.

## Your data and backups

Everything lives in the `data` folder next to the program: settings, the audit log, saved creations and your API keys (`data/keys.json`, readable only by you). Back up the whole folder, and keep it private because it contains your keys. Do not delete it unless you want to start over.

The audit log lists every request with what was checked and what the child saw. Click a row for details; flagged and failed ones are shown in red. You can export it as CSV.

## PIN and starting over

If you forget the PIN or want a new one, stop the program first (close its terminal), then run:

```
npm run reset-pin
```

It asks for a new 6-digit PIN and prints "PIN changed". Nothing else is touched: settings, keys, creations and the audit log stay, and the change is recorded in the audit log. After 5 wrong PINs the parent area is locked for 15 minutes, and it locks itself after 10 idle minutes.

To start over completely, stop the program and delete the `data` folder. That erases all settings, keys, creations and the audit log.

## Testing the safety filter (red team)

The red-team script sends 100+ tricky requests (attempts to override the rules, disguised spellings, personal details, borderline topics, plus ordinary toy requests) through the real checking pipeline using your configured keys:

```
npm run redteam
```

It prints a table (`tag | expect | got | pass`) and `passed X/Y`, and exits with an error if any request that should be blocked was shown. Ordinary requests that get blocked are listed as failures but do not fail the run.

- It uses your real keys, so it costs a small amount of money.
- Stop the server first (close the terminal running `npm start`), so the script has the data folder to itself.
- The runs are real, audited requests, not a simulation. They are marked "redteam" in the audit log and never count towards the child's daily builds.
- Your saved settings are never changed. The script applies its own settings to its own requests only: picture check off, open all day, flagged requests redirected.
- With no keys configured it prints "not run: no keys configured".

## For developers

`npm test` runs the unit tests. `npm run e2e` runs a browser test of the whole flow; it starts its own server with `FAKE_PROVIDERS=1` and a temporary data folder. `FAKE_PROVIDERS=1` replaces all AI with a canned answer and performs no real safety checks. It is only for testing: never use it for a real child. In that mode the server refuses to save API keys. `npm run reset-pin -- 123456` takes the PIN as an argument.
