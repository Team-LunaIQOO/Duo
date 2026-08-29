import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { SessionState } from '../../types/contracts';
import type { GazeController } from './gaze';

type FaceState = SessionState['faceState'];

type Props = {
  state: FaceState;
  size?: number;
  /**
   * Where to look. Optional: without it the eyes sit centred, which is exactly
   * how they behaved before, so any screen that does not pass one is
   * unaffected.
   */
  gaze?: GazeController;
};

/**
 * How far the eyes travel, as a fraction of eye size. Small on purpose — the
 * eyes should read as following someone, not as swivelling. Vertical is
 * tighter still, because a person's head moves much less up and down than side
 * to side while seated.
 */
const GAZE_TRAVEL_X = 0.3;
const GAZE_TRAVEL_Y = 0.18;

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
export function Face({ state, size = 64, gaze }: Props) {
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

  // The gaze translate goes on a wrapper around both eyes, not into the eyes'
  // own transform arrays. Two reasons, and the second is the important one:
  //
  // 1. Both eyes share one gaze, so they move together instead of crossing.
  // 2. The blink runs on the native driver. Putting a JS-updated value into
  //    the same style as a natively driven one is the classic React Native
  //    trap — the whole style node migrates to native when the blink starts,
  //    and anything that then tries to drive it from JS is a runtime error.
  //    Keeping them on separate views means the two never meet.
  //
  // Interpolating here rather than in the controller keeps the travel
  // proportional to whatever size the screen renders the face at: the active
  // session draws it at 48, the idle screen at 80.
  const gazeStyle = gaze
    ? {
        transform: [
          {
            translateX: gaze.x.interpolate({
              inputRange: [-1, 1],
              outputRange: [-size * GAZE_TRAVEL_X, size * GAZE_TRAVEL_X],
              extrapolate: 'clamp' as const,
            }),
          },
          {
            translateY: gaze.y.interpolate({
              inputRange: [-1, 1],
              outputRange: [-size * GAZE_TRAVEL_Y, size * GAZE_TRAVEL_Y],
              extrapolate: 'clamp' as const,
            }),
          },
        ],
      }
    : null;

  return (
    <Animated.View style={[styles.row, gazeStyle]}>
      <Animated.View
        style={[
          styles.eye,
          {
            width: size,
            height: eyeHeight,
            backgroundColor: eyeColor,
            transform: [{ scaleY: leftScale }],
          },
        ]}
      />
      <View style={{ width: size * 0.9 }} />
      <Animated.View
        style={[
          styles.eye,
          {
            width: size,
            height: eyeHeight,
            backgroundColor: eyeColor,
            transform: [{ scaleY: rightScale }],
          },
        ]}
      />
    </Animated.View>
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
