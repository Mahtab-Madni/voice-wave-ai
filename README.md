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

### Audio Capture Pipeline

The browser widget implements a sophisticated audio capturing pipeline with real-time amplitude monitoring for noise cancellation and voice activity detection:

#### 1. **Audio Stream Setup**

- Requests microphone access using `navigator.mediaDevices.getUserMedia()`
- Initializes Web Audio API context for real-time processing
- Creates audio analyser with configurable FFT size for frequency analysis

#### 2. **Amplitude Monitoring & Noise Cancellation**

- **Real-time Analyser**: Monitors audio frequency data 60+ times per second
- **Silence Threshold**: Configured at 0.035 (3.5% of maximum amplitude)
- **Noise Floor Detection**: Establishes baseline ambient noise level
- **Voice Activity Detection (VAD)**:
  - Tracks `lastVoiceActivityAt` timestamp
  - Detects when user starts speaking (amplitude spike above threshold)
  - Triggers recording start automatically
  - Auto-stops after 950ms of silence (configurable)
- **Debouncing**: Prevents false triggers from brief ambient noise spikes

#### 3. **Audio Chunking**

- Captures audio in small chunks as binary data
- Maintains circular buffer (max 120 chunks to prevent memory bloat)
- Each chunk represents ~8-16ms of audio at typical sample rate
- Automatic buffer rotation: older chunks discarded when limit reached

#### 4. **Transcription Scheduling**

- Implements 950ms idle timer after last audio chunk received
- Automatically flushes buffered audio to Deepgram API
- Prevents premature transcription of incomplete utterances
- Allows natural pause within sentences without cutting off

#### 5. **Processing Pipeline**

```javascript
// Simplified flow:
1. Audio chunk arrives → append to buffer
2. Schedule transcription timeout (950ms)
3. If user speaks again → reset timeout
4. On silence → send buffer to Deepgram
5. Receive transcript → send to intent planner
6. Execute action → generate TTS response
```

#### 6. **Key Parameters**

| Parameter             | Value              | Purpose                               |
| --------------------- | ------------------ | ------------------------------------- |
| Silence Threshold     | 0.035              | Amplitude floor for voice detection   |
| Flush Timeout         | 950ms              | Wait time before transcribing silence |
| Max Audio Chunks      | 120                | Prevents unbounded memory growth      |
| Voice Activity Buffer | Real-time analyser | Continuous monitoring                 |
| FFT Size              | Configurable       | Frequency resolution for analysis     |

#### 7. **Noise Cancellation Benefits**

- **Reduces False Positives**: Only captures genuine voice activity
- **Saves Bandwidth**: Prevents sending silent/ambient audio to API
- **Improves Accuracy**: Cleaner audio input to speech recognition
- **Optimizes Cost**: Fewer unnecessary transcription API calls
- **Better UX**: No spurious transcripts from background noise

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
