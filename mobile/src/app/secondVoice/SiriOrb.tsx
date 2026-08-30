import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

/**
 * The Echo orb.
 *
 * A Siri-style glowing blob, built from nothing but Views and Animated.
 *
 * ## Why it is made of circles rather than a gradient
 *
 * The obvious way to draw this is a radial gradient with a blur, and both would
 * cost a native dependency — expo-linear-gradient and expo-blur — which means a
 * package.json change and a rebuild for all three of us, for decoration. Not a
 * trade worth making the night before a demo.
 *
 * So it is four large, heavily transparent coloured circles, each orbiting the
 * centre at its own speed and pulsing on its own cycle. Where they overlap the
 * colours add up, and because they move at different rates the overlaps keep
 * changing — which is what reads as a living blob rather than as four circles.
 * At this opacity nobody sees the shapes, only the light.
 *
 * ## Everything runs on the native driver
 *
 * Only transform and opacity are animated, so the whole thing is handed to the
 * UI thread and costs the JS thread nothing. That matters here more than in a
 * normal app: this phone is running pose inference, a continuous speech
 * recogniser and a session state machine on that same thread, and an animation
 * that stutters the rep counter would be a bad bargain for a prettier screen.
 */

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

type Props = {
  state: OrbState;
  size?: number;
};

/** Siri's palette: violet through blue to pink, with a teal to cool it. */
const BLOBS = [
  { colour: '#7A5CFF', offset: 0.17, duration: 7200, phase: 0 },
  { colour: '#2BB8FF', offset: 0.20, duration: 9100, phase: 0.25 },
  { colour: '#FF4D8D', offset: 0.15, duration: 6100, phase: 0.5 },
  { colour: '#34E5C6', offset: 0.19, duration: 10400, phase: 0.75 },
];

/**
 * The rings each blob is drawn from, widest and faintest first. Together they
 * fake the soft edge of a radial gradient using only solid circles.
 */
const FALLOFF = [
  { scale: 1.0, opacity: 0.1 },
  { scale: 0.72, opacity: 0.14 },
  { scale: 0.44, opacity: 0.18 },
];

/** How the orb behaves in each state. Speed, spread and brightness. */
const BEHAVIOUR: Record<OrbState, { speed: number; scale: number; glow: number }> = {
  // Barely moving. Present, not demanding attention.
  idle: { speed: 1, scale: 0.88, glow: 0.72 },
  // Awake and quick — this is the state the user is looking at while talking.
  listening: { speed: 2.6, scale: 1.06, glow: 1 },
  // Turning over. Slower than listening but wider, so waiting reads as work.
  thinking: { speed: 1.7, scale: 0.98, glow: 0.85 },
  // Settled and warm while the sentence is spoken back.
  speaking: { speed: 1.2, scale: 1.0, glow: 0.9 },
};

export function SiriOrb({ state, size = 168 }: Props) {
  const behaviour = BEHAVIOUR[state];

  // One driver per blob, each looping 0 to 1 forever. Created once: restarting
  // them on a state change would make the orb jump, and the whole point is that
  // it never does.
  const spins = useMemo(() => BLOBS.map(() => new Animated.Value(0)), []);
  const breath = useRef(new Animated.Value(0)).current;
  const presence = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loops = spins.map((value, index) => {
      value.setValue(BLOBS[index].phase);
      return Animated.loop(
        Animated.timing(value, {
          toValue: BLOBS[index].phase + 1,
          duration: BLOBS[index].duration,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
    });

    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    loops.forEach((loop) => loop.start());
    breathing.start();

    return () => {
      loops.forEach((loop) => loop.stop());
      breathing.stop();
    };
  }, [spins, breath]);

  // State changes are eased rather than applied, so waking up is a swell and
  // not a jolt.
  useEffect(() => {
    Animated.spring(presence, {
      toValue: behaviour.scale,
      damping: 12,
      stiffness: 90,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [behaviour.scale, presence]);

  const orbit = size * 0.5;

  return (
    <View style={[styles.frame, { width: size, height: size }]} pointerEvents="none">
      {BLOBS.map((blob, index) => {
        const spin = spins[index].interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${360 * (state === 'idle' ? 1 : behaviour.speed > 2 ? 1.6 : 1.2)}deg`],
        });

        // Each blob sits off-centre inside a wrapper that rotates, so it
        // travels a circle. Different radii and periods keep them from ever
        // lining up into anything that looks like a pattern.
        return (
          <Animated.View
            key={blob.colour}
            style={[
              styles.orbit,
              { width: size, height: size, transform: [{ rotate: spin }, { scale: presence }] },
            ]}
          >
            {/*
              Each blob is three concentric circles rather than one.
              
              A flat circle has a hard edge, and hard edges are what make this
              look like overlapping shapes instead of light. Stacking a wide
              faint ring, a medium one and a small bright core approximates the
              falloff of a radial gradient — which is the thing actually wanted
              here, and which would otherwise cost a native dependency.
            */}
            {FALLOFF.map((ring) => (
              <Animated.View
                key={ring.scale}
                style={[
                  styles.blob,
                  {
                    width: size * 0.72 * ring.scale,
                    height: size * 0.72 * ring.scale,
                    borderRadius: size * 0.36 * ring.scale,
                    // Centred by explicit insets rather than by alignItems: an
                    // absolutely positioned child does not reliably inherit the
                    // parent's centring, and the symptom was blobs drifting off
                    // as separate circles instead of merging into one mass.
                    left: (size - size * 0.72 * ring.scale) / 2,
                    top: (size - size * 0.72 * ring.scale) / 2,
                    backgroundColor: blob.colour,
                    opacity: breath.interpolate({
                      inputRange: [0, 1],
                      outputRange: [
                        ring.opacity * 0.8 * behaviour.glow,
                        ring.opacity * 1.25 * behaviour.glow,
                      ],
                    }),
                    transform: [{ translateX: orbit * blob.offset }],
                  },
                ]}
              />
            ))}
          </Animated.View>
        );
      })}

      {/*
        A pale core on top. Without it the overlapping colours average out to a
        muddy middle; the core is what makes the centre look lit rather than
        merely crowded.
      */}
      <Animated.View
        style={[
          styles.core,
          {
            width: size * 0.3,
            height: size * 0.3,
            borderRadius: size * 0.15,
            transform: [{ scale: presence }],
            opacity: breath.interpolate({
              inputRange: [0, 1],
              outputRange: [0.14 * behaviour.glow, 0.3 * behaviour.glow],
            }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbit: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blob: {
    position: 'absolute',
  },
  core: {
    // Same reason as the blobs: centred by the parent's own centring, which
    // works here because it is not orbiting.
    backgroundColor: '#ffffff',
  },
});
