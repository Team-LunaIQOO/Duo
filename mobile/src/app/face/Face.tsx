import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { SessionState } from '../../types/contracts';

type FaceState = SessionState['faceState'];

type Props = {
  state: FaceState;
  size?: number;
};

const BLINK_INTERVAL_BY_STATE: Record<FaceState, [number, number]> = {
  neutral: [2500, 5500],
  attentive: [3000, 6000],
  concerned: [900, 1800],
  tired: [4500, 8000],
  acknowledging: [99999, 99999],
};

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/**
 * Two eyes, a blink animation, five states. Deliberately not a rigged
 * character — see 02-product-spec.md "The eyes": polishing this further
 * is time stolen from the actual product.
 */
export function Face({ state, size = 64 }: Props) {
  const leftScale = useRef(new Animated.Value(1)).current;
  const rightScale = useRef(new Animated.Value(1)).current;
  const [openness, setOpenness] = useState(1);

  useEffect(() => {
    if (state === 'acknowledging') {
      Animated.sequence([
        Animated.timing(leftScale, { toValue: 0.05, duration: 70, useNativeDriver: true }),
        Animated.timing(leftScale, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
      Animated.sequence([
        Animated.timing(rightScale, { toValue: 0.05, duration: 70, useNativeDriver: true }),
        Animated.timing(rightScale, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
      return;
    }

    let cancelled = false;
    const [min, max] = BLINK_INTERVAL_BY_STATE[state];

    const blink = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(leftScale, { toValue: 0.05, duration: 90, useNativeDriver: true }),
        Animated.timing(leftScale, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
      Animated.sequence([
        Animated.timing(rightScale, { toValue: 0.05, duration: 90, useNativeDriver: true }),
        Animated.timing(rightScale, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
      setTimeout(blink, randomBetween(min, max));
    };

    const timer = setTimeout(blink, randomBetween(min, max));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, leftScale, rightScale]);

  useEffect(() => {
    setOpenness(state === 'concerned' ? 0.7 : state === 'tired' ? 0.5 : 1);
  }, [state]);

  const eyeColor = state === 'concerned' ? '#e0a030' : '#ffffff';
  const eyeHeight = size * openness;

  return (
    <View style={styles.row}>
      <Animated.View
        style={[
          styles.eye,
          { width: size, height: eyeHeight, backgroundColor: eyeColor, transform: [{ scaleY: leftScale }] },
        ]}
      />
      <View style={{ width: size * 0.9 }} />
      <Animated.View
        style={[
          styles.eye,
          { width: size, height: eyeHeight, backgroundColor: eyeColor, transform: [{ scaleY: rightScale }] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eye: {
    borderRadius: 999,
  },
});
