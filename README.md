# Voice-wave

Voice-wave is a voice-first automation layer for the web. It lets a visitor or operator speak a command, interpret the intent in context, perform the matching action on the page, and respond back through speech.

The product is built around a simple idea: if someone can describe what they want in plain language, the system should be able to act on it without forcing them to click through every step manually.

## What it does

Voice-wave combines four pieces into one experience:

1. Voice capture from the browser
2. Speech-to-text transcription
3. Intent planning using page context and project metadata
4. Web action execution plus spoken feedback

In practice, this means the system can help with tasks such as:

- clicking buttons and links
- typing into forms and fields
- scrolling through content
- moving through checkout or onboarding flows
- triggering product and cart actions
- reading page text aloud
- navigating back/forward/reload
- pressing keyboard shortcuts
- hovering over elements for tooltips
- clearing input fields
- zooming in and out
- summarizing page content
- and much more through a unified voice interface

## Recently added capabilities

The latest version adds a few important reliability and intelligence upgrades:

- Round-robin API key rotation for Deepgram STT, Groq LLM planning, and Speechify TTS using comma-separated values in the environment.
- Session-based conversational memory for websocket conversations so follow-up commands such as “click it again” or “click the second button” can be disambiguated using recent turns.
- Persistent interaction logging in MongoDB, including the transcript, selected action, confidence, session ID, conversational context, and generated TTS context.

Additional intelligence and UX improvements in this release:

- **Informational LLM Responses (`RESPOND`)**: The planner can now return an informational `RESPOND` action (no DOM interaction) with a concise `message` and optional `ttsContext` for spoken summaries (useful for "What does this form require?" queries).
- **Clarification Flow (`CLARIFY`)**: When a command is ambiguous, the planner emits `CLARIFY` with `clarifyOptions` (labels + selectors). The widget presents choices to the user and executes the selected option in a follow-up turn.
- **Structured table/grid extraction + numeric parsing**: The widget extracts structured `tables` and `grids` payloads and parses numeric cell values (numbers, percents, currencies) so the planner can reason with typed numeric values for comparisons and sorting.
- **Overlay & modal dismissal**: The widget includes safe overlay/modal dismissal helpers that the client can call before attempting interactions, reducing blocked clicks and improving reliability.
- **Voice-driven navigation and richer clarification flows**: Improved routing synonyms and planner guidance to handle navigation, index-based selections ("second", "last"), and conversational follow-ups.

## How to use the widget

The widget is designed to be dropped into a website and used immediately.

### 1. Start the app

From the project root:

```bash
npm install
npm run dev
```

### 2. Open the dashboard

The React dashboard lives in the website folder and is used to configure the project, describe the site, and generate an embed snippet.

Note: the website subfolder is maintained in a separate private repository

Live deployed site: https://voice-wave-xi.vercel.app/

```bash
cd website
npm install
npm run dev
```

### 3. Use the widget on a page

Once the embed snippet is placed on a page:

- the floating widget appears on the page,
- clicking it starts listening,
- speaking a command sends it to the server,
- the planner selects an action,
- the browser performs the action,
- and the system speaks back with a short confirmation.

Typical commands might look like:

- “click the checkout button”
- “scroll down a bit”
- “type my email into the email field”
- “add the product to cart”
- “Focus on the email field”
- “Summarize this product description”
- “Select Credit Card from payment method dropdown”
- “Go to the contact page”

## Automation Features

Voice-wave supports a comprehensive set of 17 automation actions, organized into four categories:

### Navigation & Page Actions

- **GO_BACK**: Navigate to the previous page in browser history
- **GO_FORWARD**: Navigate to the next page in browser history
- **RELOAD**: Refresh the current page
- **NAVIGATE**: Jump to a specific URL or page based on voice command

### Form & Keyboard Automation

- **TYPE**: Fill input fields and textareas with extracted text or defaults
- **PRESS_KEY**: Trigger keyboard shortcuts (Enter, Escape, Tab, Arrow keys, etc.)
- **SELECT_OPTION**: Interact with dropdown menus and select elements
- **CLEAR_INPUT**: Empty text fields and textareas

### Mouse & Hover Interaction

- **CLICK**: Execute a click action on buttons, links, and interactive elements
- **HOVER**: Trigger hover states and dropdown menus
- **SCROLL**: Move through page content (up/down with configurable distance)
- **ZOOM**: Scale the page view (in/out/reset)

### Accessibility & UI Assistance

- **HIGHLIGHT_ELEMENT**: Visually highlight an element with an outline and glow effect
- **FOCUS**: Focus on an element for better accessibility
- **READ_TEXT**: Extract and speak the content of any element or section
- **SUMMARIZE_PAGE**: Generate a brief spoken summary of the page content
- **RESPOND**: Return a human-readable informational summary (no action) for queries about page content or form requirements.
- **CLARIFY**: Ask the user to disambiguate among multiple targets; returns options the widget will render and act on after selection.

## Architecture

### High-Level Flow

```text
User voice
   │
   ▼
┌─────────────────────────────────────┐
│  Audio Capture & Processing         │
│  - Amplitude monitoring             │
│  - Noise floor detection            │
│  - Silence detection (35ms buffer)  │
│  - Audio chunking (max 120 chunks)  │
└─────────────────────────────────────┘
   │
   ▼
Browser widget (mic + DOM context)
   │
   ▼
Deepgram speech-to-text transcription
   │
   ▼
Intent planner (LLM + page/project context + session conversation memory)
   │
   ├─> Browser action execution (17 actions)
   │
   └─> TTS response generation
         │
         ▼
   Session-aware conversational context + MongoDB interaction logs
         │
         ▼
      Speechify voice reply
```

### End-to-end voice pipeline (current implementation)

The current flow is a full browser → websocket → STT → LLM → TTS pipeline with explicit lifecycle control:

#### 1. **Start listening**

- The widget is activated by clicking the mic button.
- The browser requests microphone access through `navigator.mediaDevices.getUserMedia()`.
- An `AudioContext` and analyser are created for voice activity monitoring.
- A `MediaRecorder` starts streaming audio chunks to the websocket.

#### 2. **Capture audio and send it for transcription**

- Audio chunks are buffered in the browser and forwarded to the server.
- The websocket server appends the chunks and schedules a debounce timer.
- When the user pauses or the silence detector flushes, the buffered audio is sent to Deepgram for speech-to-text.
- Deepgram returns the transcript back to the client.

#### 3. **Send the transcript to the LLM planner**

- The transcript, page context, and visible DOM elements are sent to the server intent pipeline.
- The planner uses the Groq-backed LLM to choose an action such as `CLICK`, `TYPE`, `RESPOND`, `CLARIFY`, `SCROLL`, or `SUMMARIZE_PAGE`.
- The action plan is sent back to the browser for execution.

#### 4. **Generate spoken feedback with Speechify**

- If the action plan needs spoken confirmation or a conversational response, the browser calls the `/api/tts` endpoint.
- The server uses Speechify to synthesize the reply.
- The browser plays the returned audio back to the user.

#### 5. **Pause during command processing**

- When a command is being handled, the widget enters a processing state.
- Audio capture pauses so the next utterance does not overlap with the current one.
- The recorder and the analyser loop are torn down to prevent stale silence detection from interfering with the next turn.

#### 6. **Resume after processing**

- Once the action/response completes, the widget resumes listening automatically if the session is still active and the user did not explicitly stop it.
- This creates a smooth start → pause → resume cycle for consecutive commands.

#### 7. **Stop explicitly**

- If the user clicks stop or closes the widget, the session is marked as user-stopped.
- The websocket closes, the stream is stopped, and no automatic restart occurs.

#### **Timeline**

```text
Start
  → mic access granted
  → recorder + analyser started
  → audio chunks begin streaming

Speaking
  → chunks buffered
  → silence/idle timer runs
  → Deepgram STT triggered after quiet period

Transcript ready
  → transcript + DOM context sent to Groq planner
  → LLM returns an action plan

Response phase
  → spoken confirmation generated by Speechify
  → audio played back to the user

Processing pause
  → capture pauses to avoid overlapping commands

Resume / Stop
  → listening resumes automatically if session stays active
  → explicit stop ends the session permanently
```

#### **Why this lifecycle matters**

- Prevents command overlap between consecutive spoken requests
- Keeps Deepgram transcription timing stable during pauses
- Ensures spoken confirmation happens before or during action execution without mixing audio streams
- Makes the voice interaction feel like a continuous conversational session rather than a broken one-shot recorder

## Widget Configuration

The widget can be embedded with the generated snippet from the dashboard:

```html
<script
  src="https://your-domain/widget.js"
  data-project-id="your-project-id"
  async
></script>
```

If you want to override the API or websocket endpoints explicitly, you can also add attributes:

```html
<script
  src="https://your-domain/widget.js"
  data-project-id="your-project-id"
  data-api-url="https://your-domain"
  data-ws-url="wss://your-domain/voice"
  async
></script>
```

Or programmatically:

```javascript
window.__VOICE_WIDGET_API_URL__ = "https://your-domain";
window.__VOICE_WIDGET_WS_URL__ = "wss://your-domain/voice";
```

## Project structure

The repository is organized into three main areas:

- server/
  - Express server and REST routes
  - MongoDB models and controllers
  - voice planning and TTS logic
- public/
  - browser-side widget and DOM context extraction
  - injected script that records the command and executes actions

## Main components

### Voice widget

This is the front-facing experience. It captures audio, manages the listening state, collects interactive elements on the page, and sends the transcript to the server.

### Planner

The planner converts the spoken request into an action plan. It looks at the transcript, the visible DOM elements, the device context, and any project-level configuration to decide whether the correct move is a click, scroll, type, or no-op.

### TTS layer

The system can generate a spoken reply after the action plan is created or executed. That voice output is produced server-side and played back in the browser.

### Project dashboard

The React dashboard is where project metadata is created and refined. It helps describe the website and generate the embed snippet that gives the widget the right context.

## Local development

### Requirements

- Node.js
- npm
- a running MongoDB instance
- API keys for the speech, TTS, and LLM services you want to enable

### Install dependencies

From the repository root:

```bash
npm install
```

### Start the backend

```bash
npm run dev
```

The server runs on port 3000 by default.

### Start the dashboard

```bash
cd website
npm install
npm run dev
```

The dashboard is served through Vite on a local development port.

## Environment variables

Create a .env file at the project root with the values required by the services you are using.

Common variables include:

- GROQ_API_KEY
- GROQ_CHAT_MODEL
- DEEPGRAM_API_KEY
- DEEPGRAM_MODEL
- MONGODB_URI
- MONGODB_NAME
- SPEECHIFY_API_KEY

You can provide multiple keys for the same provider as a comma-separated string to enable round-robin rotation. For example:

```env
DEEPGRAM_API_KEY="key-1,key-2,key-3"
GROQ_API_KEY="key-1,key-2,key-3"
SPEECHIFY_API_KEY="key-1,key-2,key-3"
```

If one of these providers is not configured, the related route may fail or fall back gracefully depending on the current implementation.

## Current state

This project is still best understood as a working prototype for a voice-driven web assistant rather than a finished product. The core experience is already there: capture voice, turn it into intent, act on the page, and respond back aloud.

The current implementation is strongest in:

- browser-side voice input with amplitude monitoring
- real-time noise cancellation via silence detection
- intelligent audio chunking and buffer management
- comprehensive page context extraction (40+ interactive elements)
- advanced intent planning using project metadata and semantic signals
- 17 distinct automation actions across navigation, forms, mouse, and accessibility
- spoken confirmation after an action is performed
- spatial element matching with directional tie-breaking
- context-aware element selection using parent container labels
- round-robin API key rotation across providers
- session-scoped conversational context for follow-up commands
- MongoDB-backed interaction logging with session and TTS context
- structured table/grid extraction and numeric parsing for better data-aware responses
- overlay/modal dismissal support to reduce blocked interactions
- Planner supports `RESPOND` and `CLARIFY` flows for safer, more helpful automation

## Why this project exists

The goal is straightforward: let people use a website in a more natural way. Instead of relying on manual clicks and navigation alone, the system tries to bridge the gap between spoken intent and on-page execution.

## Future direction

The next stage is about reliability and polish. Likely improvements include:

- stronger streaming speech recognition
- better handling for pauses, noise, and interruptions
- more accurate planners across different kinds of websites
- a more natural voice experience for replies and confirmations

## License

This project is intended for internal development and experimentation unless otherwise noted.
