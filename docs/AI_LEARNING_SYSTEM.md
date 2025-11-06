# AI Learning System - Meta-Learning Architecture

## 🧠 Overview

A self-improving AI trading system that learns from its own predictions and outcomes. The system records predictions with confidence scores, reviews outcomes, extracts lessons using a "teacher AI" (reasoner), and applies learned lessons to future trading decisions.

## 🎯 Core Concept

1. **Trading LLM** records predictions with confidence scores before execution
2. **Feedback System** automatically scores accuracy 10-60 minutes later
3. **Reasoner LLM** (e.g., DeepSeek Reasoner) analyzes patterns and extracts lessons
4. **Lessons** are selectively added to future trading prompts based on relevance and effectiveness

---

## 📊 System Architecture

### **1. Decision Recording Flow**

**Tool:** `recordTradingVision` (called by Trading LLM)

```typescript
{
  symbol: "BTC",
  vision: "BTC will rise 0.8% in next 10min due to RSI recovery + volume spike",
  confidence: 8,          // 1-10 scale
  decision: "open_long",   // open_long, open_short, close, hold, add
  reasoning: "4h EMA golden cross + funding rate negative",
  targetPrice: 98500,
  predictionTimeframe: "10m", // 10m, 30m, 1h
  orderId: "order_123"
}
```

**Stored immediately** when LLM makes decision, before knowing outcome.

---

## 🗄️ Database Schema

### **trading_reflections** (Predictions + Outcomes)

```sql
CREATE TABLE trading_reflections (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decision_type TEXT NOT NULL,      -- open_long, close, hold, etc.
  vision TEXT NOT NULL,              -- What LLM predicted
  confidence_score INTEGER NOT NULL, -- 1-10 initial confidence
  reasoning TEXT,                    -- Why this decision
  price_at_decision REAL NOT NULL,
  target_price REAL,
  prediction_timeframe TEXT,         -- 10m, 30m, 1h
  order_id TEXT,

  -- Feedback (filled 10-60 mins later)
  actual_price REAL,
  price_change_percent REAL,
  prediction_accuracy INTEGER,       -- 0-10 (how close to target)
  feedback_score INTEGER,            -- 1-10 outcome score
  pnl_result REAL,
  outcome_type TEXT,                 -- big_win, small_win, neutral, small_loss, big_loss
  time_to_feedback_minutes INTEGER,

  lesson_id INTEGER,                 -- FK to learned lesson
  reviewed INTEGER DEFAULT 0,        -- Has LLM reviewed this?
  FOREIGN KEY (lesson_id) REFERENCES learned_lessons(id)
);

CREATE INDEX idx_reflections_symbol ON trading_reflections(symbol);
CREATE INDEX idx_reflections_timestamp ON trading_reflections(timestamp);
CREATE INDEX idx_reflections_feedback ON trading_reflections(feedback_score);
CREATE INDEX idx_reflections_reviewed ON trading_reflections(reviewed);
```

### **learned_lessons** (Extracted by Reasoner)

```sql
CREATE TABLE learned_lessons (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  lesson_category TEXT NOT NULL,     -- entry_timing, exit_timing, risk_management, symbol_behavior, market_conditions, time_of_day
  lesson_text TEXT NOT NULL,         -- Concise, actionable lesson
  supporting_reflections TEXT,       -- JSON array of reflection IDs
  counter_examples TEXT,             -- JSON array of IDs where lesson failed

  success_rate REAL,                 -- % of supporting examples that worked
  avg_pnl REAL,                      -- Average PnL impact
  confidence_level TEXT,             -- high (20+ examples), medium (10-19), low (5-9)

  market_condition TEXT,             -- bull, bear, sideways, high_volatility
  applicable_symbols TEXT,           -- "BTC,ETH" or "all"

  times_applied INTEGER DEFAULT 0,   -- How often included in prompts
  times_helpful INTEGER DEFAULT 0,   -- How often led to winning trades
  effectiveness_rate REAL,           -- helpful/applied ratio

  is_active INTEGER DEFAULT 1,
  created_by_model TEXT,             -- "deepseek-reasoner-v3"
  last_validated TEXT
);

CREATE INDEX idx_lessons_category ON learned_lessons(lesson_category);
CREATE INDEX idx_lessons_success_rate ON learned_lessons(success_rate);
CREATE INDEX idx_lessons_active ON learned_lessons(is_active);
```

### **lesson_applications** (Track Lesson Effectiveness)

```sql
CREATE TABLE lesson_applications (
  id INTEGER PRIMARY KEY,
  lesson_id INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  trade_reflection_id INTEGER,       -- Link to resulting trade
  was_helpful INTEGER,               -- 0 or 1 (determined by outcome)
  pnl_impact REAL,
  FOREIGN KEY (lesson_id) REFERENCES learned_lessons(id),
  FOREIGN KEY (trade_reflection_id) REFERENCES trading_reflections(id)
);

CREATE INDEX idx_applications_lesson ON lesson_applications(lesson_id);
CREATE INDEX idx_applications_helpful ON lesson_applications(was_helpful);
```

---

## ⏱️ Timeline & Workflow

### **14:00 - Trading Decision**
```
LLM analyzes BTC
├─ Loads 10 relevant lessons from past
├─ Makes decision: OPEN LONG
├─ Calls recordTradingVision tool:
│  ├─ Vision: "BTC +0.8% in 10min"
│  ├─ Confidence: 8/10
│  ├─ Target: $98,500
│  └─ Stores in trading_reflections
└─ Executes order_123
```

### **14:10 - Feedback Calculation (Profit Manager)**
```
Profit manager detects reflection from 14:00
├─ BTC now at $98,450 (+0.7%)
├─ Calculate accuracy: 9/10 (close to target)
├─ Calculate feedback_score: 9/10 (prediction accurate + profitable)
├─ Update reflection with outcome
└─ Mark for lesson extraction
```

### **15:00 - Lesson Learning (Separate Scheduler)**
```
Lesson Generator runs every 2 hours
├─ Fetch 50 recent reflections with feedback
├─ Group by patterns (winning vs losing)
├─ Send to DeepSeek Reasoner:
│  "Analyze these 50 trading outcomes.
│   Extract 3-5 key lessons that explain
│   why some trades succeeded and others failed."
├─ Reasoner generates lessons:
│  ├─ Lesson 1: "RSI recovery + volume spike = 80% win rate for BTC longs"
│  ├─ Lesson 2: "Avoid shorting ETH when funding rate < -0.05%"
│  └─ Lesson 3: "Exit positions before US market close on Fridays"
├─ Store lessons with supporting evidence
└─ Calculate success rates
```

### **14:15 - Next Trading Decision (Using Lessons)**
```
LLM runs again
├─ Lesson learning: ENABLED (10 lessons)
├─ Fetch top 10 relevant lessons:
│  ├─ Filter by: current market condition
│  ├─ Sort by: success_rate * confidence_level
│  └─ Prioritize: lessons for current symbols
├─ Add to prompt:
│  "📚 LESSONS FROM PAST EXPERIENCE:
│   1. [Success rate: 80%] RSI recovery + volume spike...
│   2. [Success rate: 75%] Avoid shorts when funding..."
└─ LLM makes BETTER decision using historical wisdom
```

---

## 🧮 Feedback Scoring Algorithm

### **Automatic Feedback Calculation**

```typescript
function calculateFeedbackScore(reflection, outcome): number {
  let score = 5; // Start neutral

  // Price prediction accuracy (±40%)
  if (reflection.decision_type.includes('open')) {
    const priceDiff = Math.abs(outcome.actual_price - reflection.target_price);
    const accuracy = 1 - (priceDiff / reflection.price_at_decision);
    score += accuracy * 4;
  }

  // PnL outcome (±30%)
  if (outcome.pnl > 0) {
    score += Math.min(outcome.pnl / 20, 3); // Cap at +3
  } else {
    score += Math.max(outcome.pnl / 20, -3); // Cap at -3
  }

  // Directional correctness (±30%)
  const expectedDirection = reflection.decision_type.includes('long') ? 1 : -1;
  const actualDirection = outcome.price_change_percent > 0 ? 1 : -1;
  if (expectedDirection === actualDirection) {
    score += 3;
  } else {
    score -= 3;
  }

  return Math.max(1, Math.min(10, Math.round(score)));
}
```

### **Prediction Accuracy Calculation**

```typescript
function calculatePredictionAccuracy(reflection: any, actualPrice: number): number {
  if (!reflection.target_price) return 5; // Neutral if no target

  const expectedChange = reflection.target_price - reflection.price_at_decision;
  const actualChange = actualPrice - reflection.price_at_decision;

  // Perfect prediction = 10, opposite = 0
  const accuracy = Math.max(0, Math.min(10,
    10 * (1 - Math.abs(expectedChange - actualChange) / Math.abs(expectedChange))
  ));

  return Math.round(accuracy);
}
```

### **Outcome Type Classification**

```typescript
function determineOutcomeType(priceChange: number, pnl: number): string {
  if (pnl > 50) return 'big_win';
  if (pnl > 10) return 'small_win';
  if (pnl > -10) return 'neutral';
  if (pnl > -50) return 'small_loss';
  return 'big_loss';
}
```

---

## 📚 Lesson Categories

1. **entry_timing** - When to open positions
2. **exit_timing** - When to close/take profit
3. **risk_management** - Stop-loss, position sizing
4. **symbol_behavior** - Specific crypto patterns
5. **market_conditions** - Bull/bear/sideways strategies
6. **time_of_day** - US/Asia market hours
7. **funding_rate** - Funding rate patterns

---

## 🎯 Lesson Retrieval Strategy

### **Relevance Scoring Formula**

```typescript
async function getRelevantLessons(context) {
  const lessons = await db.execute(`
    SELECT *,
      (success_rate * 0.5 +
       effectiveness_rate * 0.3 +
       confidence_level_score * 0.2) as relevance_score
    FROM learned_lessons
    WHERE is_active = 1
      AND (applicable_symbols LIKE '%${context.symbol}%' OR applicable_symbols = 'all')
      AND market_condition = '${context.current_market}'
      AND datetime(created_at) >= datetime('now', '-${context.lessonAgeDays} days')
    ORDER BY relevance_score DESC
    LIMIT ${context.lessonCount}
  `);
  return lessons;
}
```

### **Lesson Decay & Validation**

- **Lessons older than 30 days:** Reduce weight by 50%
- **Lessons not applied in 7 days:** Mark for review
- **Lessons with effectiveness < 40%:** Auto-disable
- **Re-validate lessons monthly** with fresh data

---

## 🖥️ UI Design

### **Learning Control Panel**

```html
<section class="chart-section ai-learning-section">
  <div class="chart-header">
    <h3 class="chart-title">
      🧠 AI Learning System
      <span class="learning-badge" id="learning-status">DISABLED</span>
    </h3>
    <button class="toggle-learning-button" id="toggle-learning-button">
      <span id="learning-button-text">ENABLE LEARNING</span>
    </button>
  </div>

  <div class="learning-config">
    <!-- Lesson Count Selector -->
    <div class="config-row">
      <label>Lessons per decision:</label>
      <select id="lesson-count">
        <option value="5">5 lessons</option>
        <option value="10" selected>10 lessons (Recommended)</option>
        <option value="15">15 lessons</option>
        <option value="20">20 lessons (Max context)</option>
      </select>
    </div>

    <!-- Lesson Quality Filter -->
    <div class="config-row">
      <label>Minimum success rate:</label>
      <select id="min-success-rate">
        <option value="60">60% (Include experimental)</option>
        <option value="70" selected>70% (Balanced)</option>
        <option value="80">80% (High confidence only)</option>
      </select>
    </div>

    <!-- Lesson Age Filter -->
    <div class="config-row">
      <label>Lesson freshness:</label>
      <select id="lesson-age">
        <option value="7">Last 7 days only</option>
        <option value="30" selected>Last 30 days</option>
        <option value="90">Last 90 days</option>
        <option value="0">All time</option>
      </select>
    </div>
  </div>

  <!-- Learning Statistics -->
  <div class="learning-stats">
    <div class="stat-card">
      <div class="stat-label">Total Reflections</div>
      <div class="stat-value" id="total-reflections">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Active Lessons</div>
      <div class="stat-value" id="active-lessons">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg Lesson Effectiveness</div>
      <div class="stat-value" id="lesson-effectiveness">0%</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Pending Reviews</div>
      <div class="stat-value" id="pending-reviews">0</div>
    </div>
  </div>

  <!-- Top Lessons Display -->
  <div class="top-lessons">
    <h4>🏆 Most Effective Lessons</h4>
    <div id="lessons-list" class="lessons-container">
      <!-- Dynamically populated -->
    </div>
  </div>

  <!-- Recent Reflections -->
  <div class="recent-reflections">
    <h4>📝 Recent Predictions & Outcomes</h4>
    <div class="reflection-filters">
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="accurate">Accurate (8+)</button>
      <button class="filter-btn" data-filter="inaccurate">Inaccurate (≤4)</button>
      <button class="filter-btn" data-filter="pending">Pending Feedback</button>
    </div>
    <div id="reflections-list" class="reflections-container">
      <!-- Dynamically populated -->
    </div>
  </div>
</section>
```

### **Lesson Card Component**

```html
<div class="lesson-card" data-lesson-id="123">
  <div class="lesson-header">
    <span class="lesson-category">Entry Timing</span>
    <span class="lesson-success-rate success-high">85%</span>
  </div>
  <div class="lesson-text">
    RSI recovery from oversold + volume spike above 1.5x avg = 85% win rate for BTC longs within 15min
  </div>
  <div class="lesson-meta">
    <span>📊 Applied: 23 times</span>
    <span>✅ Helpful: 19 times</span>
    <span>💰 Avg PnL: +$12.50</span>
    <span>📅 Created: 2 days ago</span>
  </div>
  <div class="lesson-actions">
    <button class="btn-view-details" data-lesson-id="123">View Details</button>
    <button class="btn-disable-lesson" data-lesson-id="123">Disable</button>
  </div>
</div>
```

### **Reflection Card Component**

```html
<div class="reflection-card" data-reflection-id="456">
  <div class="reflection-header">
    <span class="reflection-symbol">BTC</span>
    <span class="reflection-time">2 hours ago</span>
    <span class="confidence-badge confidence-8">Confidence: 8/10</span>
  </div>

  <div class="reflection-vision">
    💭 "BTC will rise 0.8% in next 10min due to RSI recovery + volume spike"
  </div>

  <div class="reflection-decision">
    <span class="decision-badge decision-long">OPENED LONG</span>
    <span>@ $98,200</span>
    <span>Target: $98,500</span>
  </div>

  <div class="reflection-outcome">
    <div class="outcome-row">
      <span>Actual Price:</span>
      <span class="price-up">$98,450 (+0.7%)</span>
    </div>
    <div class="outcome-row">
      <span>Prediction Accuracy:</span>
      <span class="accuracy-score accuracy-9">9/10 ⭐</span>
    </div>
    <div class="outcome-row">
      <span>Feedback Score:</span>
      <span class="feedback-score feedback-9">9/10 (Excellent)</span>
    </div>
    <div class="outcome-row">
      <span>PnL:</span>
      <span class="pnl-positive">+$18.50</span>
    </div>
  </div>

  <div class="reflection-reasoning">
    <details>
      <summary>View Full Reasoning</summary>
      <p>4h EMA golden cross confirmed, funding rate negative (-0.03%), RSI bounced from 32 to 45, volume 1.6x above average...</p>
    </details>
  </div>
</div>
```

---

## 🏗️ Module Structure

```
src/
├── learning/
│   ├── reflections/
│   │   ├── reflectionService.ts      # CRUD for reflections
│   │   ├── feedbackCalculator.ts     # Auto-calculate feedback scores
│   │   └── reflectionRepository.ts   # DB access
│   │
│   ├── lessons/
│   │   ├── lessonService.ts          # Lesson CRUD + retrieval
│   │   ├── lessonGenerator.ts        # Call reasoner LLM
│   │   ├── lessonValidator.ts        # Effectiveness tracking
│   │   └── lessonRepository.ts       # DB access
│   │
│   └── schedulers/
│       ├── feedbackScheduler.ts      # Run every 5min (update feedback)
│       └── lessonGeneratorScheduler.ts # Run every 2h (generate lessons)
│
├── tools/
│   └── learning/
│       └── recordVision.ts           # Tool for trading LLM
│
└── api/
    └── routes.ts                     # Add learning endpoints
```

---

## 🤔 Open Questions & Design Decisions

### **A) Should we track lesson "staleness"?**
- Lessons based on 30-day-old data might not work in current market
- **Proposal:** Auto-disable lessons if market conditions have shifted significantly
- **Decision needed:** How to detect market condition changes?

### **B) Should LLM be forced to use recordVision tool?**
- **Option 1:** Make it mandatory (every decision must record vision)
- **Option 2:** Make it optional (LLM decides when confident enough)
- **Decision needed:** Which approach?

### **C) Lesson conflict resolution:**
- What if two lessons contradict each other?
- Example: Lesson A says "Long BTC on RSI < 30" but Lesson B says "Avoid longs in bear market"
- **Proposal:** Show both + let LLM decide based on context
- **Decision needed:** Should we filter contradictions?

### **D) Reasoner model selection:**
- `deepseek/deepseek-reasoner` - Good at analysis, slower
- `deepseek/deepseek-r1` - Faster, less detailed
- `anthropic/claude-3.7-sonnet` - Best reasoning but expensive
- **Decision needed:** Which model for lesson generation?

### **E) Feedback timing:**
- Currently: 10-60 mins after decision
- **Should we also add:**
  - 4-hour feedback (longer trend validation)?
  - End-of-day feedback (full position lifecycle)?
- **Decision needed:** Multiple feedback points or just 10min?

### **F) Lesson privacy/export:**
- Should users be able to:
  - Export lessons to JSON?
  - Import lessons from other users?
  - Share high-performing lessons publicly?
- **Decision needed:** Open vs closed ecosystem?

---

## 📋 Implementation Checklist

### **Phase 1: Database Foundation**
- [ ] Create database migration for new tables
- [ ] Add indexes for performance
- [ ] Create repository classes
- [ ] Add seed data for testing

### **Phase 2: Recording System**
- [ ] Create `recordTradingVision` tool
- [ ] Add tool to trading agent
- [ ] Update agent prompt to use tool
- [ ] Test prediction recording

### **Phase 3: Feedback System**
- [ ] Implement feedback calculation algorithms
- [ ] Add feedback updater to profit manager
- [ ] Create feedback scheduler (runs every 5min)
- [ ] Test automatic feedback scoring

### **Phase 4: Lesson Generator**
- [ ] Create reasoner LLM integration
- [ ] Build lesson extraction logic
- [ ] Implement lesson parser
- [ ] Create lesson generator scheduler (runs every 2h)
- [ ] Test lesson generation

### **Phase 5: Trading Integration**
- [ ] Add lesson fetching to trading loop
- [ ] Update prompt to include lessons
- [ ] Implement lesson application tracking
- [ ] Update effectiveness metrics

### **Phase 6: UI Components**
- [ ] Create learning control panel HTML
- [ ] Add CSS styling
- [ ] Implement JavaScript functions
- [ ] Create API endpoints for UI
- [ ] Add lesson cards and reflection cards

### **Phase 7: Validation & Optimization**
- [ ] Implement lesson decay system
- [ ] Add effectiveness tracking
- [ ] Create validation scheduler
- [ ] Optimize SQL queries
- [ ] Add monitoring/logging

---

## 🚀 Environment Variables

```bash
# AI Learning System
LEARNING_ENABLED=true
REASONER_MODEL=deepseek/deepseek-reasoner
REASONER_API_KEY=your_api_key
REASONER_BASE_URL=https://openrouter.ai/api/v1

# Feedback Timing
FEEDBACK_MIN_MINUTES=10
FEEDBACK_MAX_MINUTES=60

# Lesson Generation
LESSON_GENERATION_INTERVAL=2h
LESSON_MIN_REFLECTIONS=10
LESSON_MAX_REFLECTIONS=50

# Lesson Retrieval
DEFAULT_LESSON_COUNT=10
DEFAULT_MIN_SUCCESS_RATE=70
DEFAULT_LESSON_AGE_DAYS=30
```

---

## 📊 Success Metrics

- **Prediction Accuracy:** Average feedback score of all reflections
- **Lesson Effectiveness:** % of applied lessons that led to winning trades
- **Learning Impact:** Compare win rate before/after enabling lessons
- **System Health:** % of reflections with feedback vs pending
- **Lesson Quality:** Average success rate of active lessons

---

## 🎓 Example Use Cases

### **Example 1: RSI Pattern Discovery**

**Reflections:**
- 15 BTC longs opened when RSI < 30 + volume spike → 12 wins (80%)
- 8 BTC longs opened when only RSI < 30 → 3 wins (37.5%)

**Generated Lesson:**
```
[CATEGORY: entry_timing]
[SYMBOLS: BTC]
[LESSON: RSI recovery from oversold (< 30) + volume spike > 1.5x avg = 80% win rate for longs within 15min. RSI alone is insufficient (37% win rate).]
[SUPPORTING_IDS: 1,3,7,12,...]
```

### **Example 2: Time-of-Day Pattern**

**Reflections:**
- 10 positions closed before US close on Fridays → 9 wins (90%)
- 12 positions held over weekend → 4 wins (33%)

**Generated Lesson:**
```
[CATEGORY: exit_timing]
[SYMBOLS: all]
[LESSON: Close positions before US market close on Fridays (16:00 EST). Holding over weekend has 33% win rate vs 90% for Friday exits.]
[SUPPORTING_IDS: 23,27,31,...]
```

---

## 🔄 Continuous Improvement

The system continuously improves through:
1. **New reflections** add more data points
2. **Feedback loops** validate or invalidate lessons
3. **Reasoner analysis** discovers new patterns
4. **Effectiveness tracking** filters out bad lessons
5. **User feedback** (manual disable/enable of lessons)

This creates a **virtuous cycle** where the AI gets progressively better at trading by learning from its own experience.

---

**Document Version:** 1.0
**Last Updated:** 2025-11-07
**Status:** Planning Complete - Ready for Implementation
