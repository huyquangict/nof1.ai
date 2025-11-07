/**
 * Feature Extraction for ML Predictions
 * Converts market data to 60-feature vector for XGBoost model
 */

import type { RegimeClassification } from "../utils/adaptiveParameters";

/**
 * Market data structure (from tradingLoop collectMarketData)
 */
export interface MarketDataForML {
	// Current price
	currentPrice: number;

	// Price sequences (recent 3 closes from each timeframe)
	price1m: number[];
	price3m: number[];
	price5m: number[];
	price15m: number[];
	price30m: number[];

	// Phase 1 indicators
	ema20: number;
	ema50: number;
	macd: number;
	macdSignal: number;
	macdHistogram: number;
	rsi7: number;
	rsi14: number;
	volume: number;
	volumeSma20: number;
	volumeRatio: number;

	// Phase 2 indicators
	atr14: number;
	bbUpper: number;
	bbMiddle: number;
	bbLower: number;
	bbBandwidth: number;
	vwap: number;
	obv: number;
	obvEma20: number;
	srsiK: number;
	srsiD: number;
	kcUpper: number;
	kcLower: number;
	support: number;
	resistance: number;

	// Phase 3A regime
	regime?: {
		classification: string;
		confidence: number;
		volatilityLevel: string;
		trendStrength: number;
		atrRatio: number;
		volumeSurge: number;
		adx: number;
	};
}

/**
 * Extract 60 features from market data
 * Feature order MUST match Python ml_service.py FEATURE_NAMES
 */
export function extractFeatures(data: MarketDataForML): number[] {
	const features: number[] = [];

	// ========================================
	// Price sequences (15 features)
	// ========================================

	// 1m timeframe - last 3 closes
	const price1m = data.price1m.slice(-3);
	features.push(
		price1m[0] || data.currentPrice,
		price1m[1] || data.currentPrice,
		price1m[2] || data.currentPrice,
	);

	// 3m timeframe - last 3 closes
	const price3m = data.price3m.slice(-3);
	features.push(
		price3m[0] || data.currentPrice,
		price3m[1] || data.currentPrice,
		price3m[2] || data.currentPrice,
	);

	// 5m timeframe - last 3 closes
	const price5m = data.price5m.slice(-3);
	features.push(
		price5m[0] || data.currentPrice,
		price5m[1] || data.currentPrice,
		price5m[2] || data.currentPrice,
	);

	// 15m timeframe - last 3 closes
	const price15m = data.price15m.slice(-3);
	features.push(
		price15m[0] || data.currentPrice,
		price15m[1] || data.currentPrice,
		price15m[2] || data.currentPrice,
	);

	// 30m timeframe - last 3 closes
	const price30m = data.price30m.slice(-3);
	features.push(
		price30m[0] || data.currentPrice,
		price30m[1] || data.currentPrice,
		price30m[2] || data.currentPrice,
	);

	// ========================================
	// Phase 1 indicators (10 features)
	// ========================================
	features.push(
		data.ema20,
		data.ema50,
		data.macd,
		data.macdSignal,
		data.macdHistogram,
		data.rsi7,
		data.rsi14,
		data.volume,
		data.volumeSma20,
		data.volumeRatio,
	);

	// ========================================
	// Phase 2 indicators (15 features)
	// ========================================
	const priceToSupportRatio =
		data.support > 0 ? data.currentPrice / data.support : 1.0;

	features.push(
		data.atr14,
		data.bbUpper,
		data.bbMiddle,
		data.bbLower,
		data.bbBandwidth,
		data.vwap,
		data.obv,
		data.obvEma20,
		data.srsiK,
		data.srsiD,
		data.kcUpper,
		data.kcLower,
		data.support,
		data.resistance,
		priceToSupportRatio,
	);

	// ========================================
	// Phase 3A market regime (10 features)
	// ========================================
	if (data.regime) {
		// One-hot encode regime classification
		const regimeTrendingBull =
			data.regime.classification === "TRENDING_BULL" ? 1.0 : 0.0;
		const regimeTrendingBear =
			data.regime.classification === "TRENDING_BEAR" ? 1.0 : 0.0;
		const regimeRangingVolatile =
			data.regime.classification === "RANGING_VOLATILE" ? 1.0 : 0.0;
		const regimeRangingCalm =
			data.regime.classification === "RANGING_CALM" ? 1.0 : 0.0;
		const regimeBreakout =
			data.regime.classification === "BREAKOUT" ? 1.0 : 0.0;

		// Encode volatility level
		let volatilityLevel = 0.0;
		if (data.regime.volatilityLevel === "LOW") volatilityLevel = 0.33;
		else if (data.regime.volatilityLevel === "MEDIUM") volatilityLevel = 0.67;
		else if (data.regime.volatilityLevel === "HIGH") volatilityLevel = 1.0;

		features.push(
			regimeTrendingBull,
			regimeTrendingBear,
			regimeRangingVolatile,
			regimeRangingCalm,
			regimeBreakout,
			data.regime.confidence,
			data.regime.adx,
			volatilityLevel,
			data.regime.trendStrength,
			data.regime.volumeSurge,
		);
	} else {
		// No regime data - use zeros
		features.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
	}

	// ========================================
	// Derived features (10 features)
	// ========================================

	// Price change percentage (current vs 5m ago)
	const priceChangePct =
		price5m.length > 0 && price5m[0] > 0
			? ((data.currentPrice - price5m[0]) / price5m[0]) * 100
			: 0;

	// EMA cross signal (-1=bearish, 0=neutral, 1=bullish)
	const emaCross = data.ema20 > data.ema50 ? 1.0 : data.ema20 < data.ema50 ? -1.0 : 0.0;

	// RSI momentum (difference between RSI7 and RSI14)
	const rsiMomentum = data.rsi7 - data.rsi14;

	// Bollinger Band position (0=lower band, 0.5=middle, 1=upper band)
	const bbRange = data.bbUpper - data.bbLower;
	const bbPosition =
		bbRange > 0 ? (data.currentPrice - data.bbLower) / bbRange : 0.5;

	// Volume trend (current vs SMA20)
	const volumeTrend =
		data.volumeSma20 > 0 ? data.volume / data.volumeSma20 : 1.0;

	// Trend alignment (-1 to 1): how aligned are EMA, MACD, RSI
	let trendAlignment = 0;
	if (data.currentPrice > data.ema20) trendAlignment += 0.33;
	if (data.macdHistogram > 0) trendAlignment += 0.33;
	if (data.rsi14 > 50) trendAlignment += 0.34;
	trendAlignment = trendAlignment * 2 - 1; // Scale to [-1, 1]

	// Volatility regime (ATR / price)
	const volatilityRegime = (data.atr14 / data.currentPrice) * 100;

	// Support distance (how far from support)
	const supportDistance =
		data.support > 0
			? ((data.currentPrice - data.support) / data.support) * 100
			: 0;

	// Resistance distance (how far from resistance)
	const resistanceDistance =
		data.resistance > 0
			? ((data.resistance - data.currentPrice) / data.currentPrice) * 100
			: 0;

	// Price momentum (based on multiple timeframes)
	let priceMomentum = 0;
	if (price1m.length >= 2) {
		priceMomentum += (price1m[2] - price1m[0]) / price1m[0];
	}
	if (price5m.length >= 2) {
		priceMomentum += (price5m[2] - price5m[0]) / price5m[0];
	}
	if (price15m.length >= 2) {
		priceMomentum += (price15m[2] - price15m[0]) / price15m[0];
	}
	priceMomentum = priceMomentum * 100; // Convert to percentage

	features.push(
		priceChangePct,
		emaCross,
		rsiMomentum,
		bbPosition,
		volumeTrend,
		trendAlignment,
		volatilityRegime,
		supportDistance,
		resistanceDistance,
		priceMomentum,
	);

	// Validate feature count
	if (features.length !== 60) {
		throw new Error(
			`Feature count mismatch: expected 60, got ${features.length}`,
		);
	}

	// Validate all features are numbers
	for (let i = 0; i < features.length; i++) {
		if (!Number.isFinite(features[i])) {
			// Replace NaN/Infinity with 0
			features[i] = 0;
		}
	}

	return features;
}

/**
 * Feature names (must match Python ml_service.py)
 */
export const FEATURE_NAMES = [
	// Price sequences (15)
	"price_1m_1",
	"price_1m_2",
	"price_1m_3",
	"price_3m_1",
	"price_3m_2",
	"price_3m_3",
	"price_5m_1",
	"price_5m_2",
	"price_5m_3",
	"price_15m_1",
	"price_15m_2",
	"price_15m_3",
	"price_30m_1",
	"price_30m_2",
	"price_30m_3",

	// Phase 1 indicators (10)
	"ema20",
	"ema50",
	"macd",
	"macd_signal",
	"macd_histogram",
	"rsi7",
	"rsi14",
	"volume",
	"volume_sma20",
	"volume_ratio",

	// Phase 2 indicators (15)
	"atr14",
	"bb_upper",
	"bb_middle",
	"bb_lower",
	"bb_bandwidth",
	"vwap",
	"obv",
	"obv_ema20",
	"srsi_k",
	"srsi_d",
	"kc_upper",
	"kc_lower",
	"support",
	"resistance",
	"price_to_support_ratio",

	// Phase 3A regime (10)
	"regime_trending_bull",
	"regime_trending_bear",
	"regime_ranging_volatile",
	"regime_ranging_calm",
	"regime_breakout",
	"regime_confidence",
	"adx",
	"volatility_level",
	"trend_strength",
	"volume_surge",

	// Derived features (10)
	"price_change_pct",
	"ema_cross",
	"rsi_momentum",
	"bb_position",
	"volume_trend",
	"trend_alignment",
	"volatility_regime",
	"support_distance",
	"resistance_distance",
	"price_momentum",
];

/**
 * Get feature importance explanation
 */
export function getFeatureDescription(featureName: string): string {
	const descriptions: Record<string, string> = {
		price_1m_1: "Price 1 minute ago",
		price_1m_2: "Price 2 minutes ago",
		price_1m_3: "Price 3 minutes ago",
		ema20: "20-period Exponential Moving Average",
		ema50: "50-period Exponential Moving Average",
		macd: "MACD line",
		macd_signal: "MACD signal line",
		macd_histogram: "MACD histogram",
		rsi7: "7-period RSI",
		rsi14: "14-period RSI",
		volume: "Current volume",
		atr14: "14-period Average True Range",
		bb_bandwidth: "Bollinger Bands width",
		vwap: "Volume Weighted Average Price",
		obv: "On-Balance Volume",
		regime_trending_bull: "Bullish trend regime indicator",
		regime_trending_bear: "Bearish trend regime indicator",
		adx: "Average Directional Index (trend strength)",
		price_change_pct: "Price change percentage",
		ema_cross: "EMA crossover signal",
		trend_alignment: "Multi-indicator trend alignment",
		// ... add more as needed
	};

	return descriptions[featureName] || featureName;
}
