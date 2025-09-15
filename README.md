# Fullstack Developer Technical Assignment

## Overview

This assignment evaluates your ability to **rapidly learn new technologies** and **solve complex problems using AI tools**. We expect you to leverage AI assistants (ChatGPT, Claude, Copilot, etc.) throughout this process, as this reflects real-world development practices.

**Time Limit:** 4-6 hours
**Technologies:** Docker, Redpanda, Rust, NextJS, TypeScript


## Evaluation Criteria

### What We're Evaluating

**Primary Focus:** Your ability to rapidly learn unfamiliar technologies and effectively leverage AI tools to solve complex problems.

We expect most candidates have **limited or no experience** with Redpanda/Kafka, Rust, real-time data streaming, blockchain concepts, pump.fun, or financial trading indicators like RSI. This is intentional - we're evaluating your **learning agility** and **AI-assisted problem-solving skills**, not prior knowledge in cryptocurrency or financial markets.

### Evaluation Framework

**Completion-Based Scoring:** You will be ranked against other candidates based on **percentage of functional components completed**. A partially working system with solid foundations scores higher than a non-functional but "complete" codebase.

**Scoring Breakdown:**
- **25%** - Infrastructure Setup (Docker + Redpanda running)
- **25%** - Data Ingestion (CSV → Redpanda topics)
- **25%** - Backend Processing (Rust RSI calculations)
- **25%** - Frontend Dashboard (NextJS visualization)

### Important Guidelines

**No Support Provided:** We will not answer questions during the assignment to ensure fairness. Use AI tools, documentation, and research to resolve any ambiguities.

**Interpretation Freedom:** If requirements are unclear, document your assumptions and proceed with the most reasonable interpretation. We value decisive problem-solving over perfect specification adherence.

**Progress Over Perfection:** Submit whatever you accomplish. A working Phase 1 + 2 is more valuable than broken code across all phases.

**AI Usage Expected:** Document your AI tool usage extensively. Effective AI collaboration is a core skill we're measuring.

**Technology Requirements:** You MUST use the specified technologies (Docker, Redpanda, Rust, NextJS, TypeScript) exactly as listed. Do not substitute with alternatives (e.g., Kafka instead of Redpanda, Python instead of Rust, React instead of NextJS). This ensures fair evaluation since all candidates work with the same unfamiliar technology stack.

---

## Background

You've been tasked with building a **real-time cryptocurrency trading analytics system** using pump.fun trading data. The system should process live trading data, calculate technical indicators, and display them in an interactive dashboard.

**Note:** We understand you may be unfamiliar with blockchain concepts, cryptocurrency trading, pump.fun platforms, or financial indicators like RSI. This is completely expected and part of the challenge - use AI tools to quickly research and understand these domain concepts as needed.

---

## Technical Challenge

You will use the `trades_data.csv` file in this git repository containing ~500 trades from 5 different pump.fun tokens with the following structure:

```csv
block_time,transaction_signature,block_num,program_id,trade_type,wallet_address,token_address,is_buy,amount_in_sol,amount_in_token,change_in_sol,change_in_tokens,price_in_sol,virtual_sol_reserves,virtual_token_reserves,real_sol_reserves,real_token_reserves,fee_recipient,fee_basis_points,fee_amount,creator_address,creator_fee_basis_points,creator_fee_amount,ingested_at
```

---

## Assignment Tasks

### Phase 1: Infrastructure Setup (Docker + Redpanda)

**Objective:** Set up a Redpanda broker using Docker for real-time data streaming.

**Requirements:**
1. Create a `docker-compose.yml` that spins up a Redpanda instance
2. Configure Redpanda with appropriate settings for local development
3. Create two topics: `trade-data` and `rsi-data`
4. Ensure the setup includes a management UI (Redpanda Console)

---

### Phase 2: Data Ingestion (Any Language)

**Objective:** Load the CSV data into Redpanda as a stream of messages.

**Requirements:**
1. Write a data ingestion script (Python, Node.js, or any language)
2. Parse `trades_data.csv` and publish each trade as a JSON message to the `trade-data` topic

---

### Phase 3: Backend Development (Rust)

**Objective:** Build a Rust microservice that calculates RSI (Relative Strength Index).

**Requirements:**
1. Create a Rust application using `tokio` and `rdkafka` (or similar Kafka client)
2. Consume messages from the `trade-data` topic
3. Implement RSI calculation for each token (14-period RSI is standard)
4. Publish calculated RSI values to the `rsi-data` topic

---

### Phase 4: Frontend Development (NextJS)

**Objective:** Create a dashboard displaying price and RSI data.

**Requirements:**
1. Build a NextJS application with TypeScript
2. Create a single-page dashboard with:
   - Token selector dropdown (showing all 5 tokens from the data)
   - Price chart (line chart)
   - RSI chart (line chart with 30/70 overbought/oversold lines)
   - Price and RSI values displayed as numbers
3. Use a charting library (Chart.js, Recharts, or similar)

**UI Requirements:**
- Clean, professional interface

---

## AI Tool Usage Guidelines

**We ENCOURAGE and EXPECT you to use AI tools extensively:**

1. **Research:** Use AI to understand Redpanda, Rust ecosystems, blockchain trading concepts, pump.fun platforms, and RSI calculations
2. **Code Generation:** Generate boilerplate code, configuration files, and implementation scaffolds
3. **Problem Solving:** Get help with specific technical challenges and debugging
4. **Best Practices:** Ask for code review, optimization suggestions, and architectural guidance

---

## Submission Requirements

### Submission Method:
1. Create a GitHub repository with your solution
2. Record a 1-2 minute video demonstrating the working system of RSI data being produced into redpanda and the frontend.
4. Submit the GitHub link and video to your point of contact email.

---

**Good luck! We're excited to see your problem-solving approach and how effectively you leverage modern AI development tools.**

---

*This assignment tests real-world skills: working with unfamiliar technology stacks, processing streaming data, building full-stack applications, and most importantly, using AI tools to accelerate development in a fast-paced environment.*
