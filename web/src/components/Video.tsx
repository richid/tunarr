import Lightbulb from '@mui/icons-material/Lightbulb';
import { Alert, Box } from '@mui/material';
import Button from '@mui/material/Button';
import Hls from 'hls.js';
import { isError, isNil } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { apiClient } from '../external/api.ts';
import { toggle } from '../helpers/util.ts';
import { useFfmpegSettings } from '../hooks/settingsHooks.ts';
import { useHls } from '../hooks/useHls.ts';
import StandaloneToggleButton from './base/StandaloneToggleButton.tsx';

type VideoProps = {
  channelNumber: number;
};

export default function Video({ channelNumber }: VideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { hls, resetHls } = useHls();
  const hlsSupported = useMemo(() => Hls.isSupported(), []);
  const [loadedStream, setLoadedStream] = useState<boolean | Error>(false);
  const { data: ffmpegSettings, isLoading: ffmpegSettingsLoading } =
    useFfmpegSettings();
  const [lightsOff, setLightsOff] = useState(false);

  const canLoadStream = useMemo(() => {
    const initialized = !isNil(videoRef.current) && !isNil(hls);
    const alreadedLoadedOrError = isError(loadedStream) || loadedStream;
    const validSettings =
      !ffmpegSettingsLoading &&
      !isNil(ffmpegSettings) &&
      !['ac3'].includes(ffmpegSettings.audioEncoder);
    return initialized && !alreadedLoadedOrError && validSettings;
  }, [videoRef, hls, loadedStream, ffmpegSettingsLoading, ffmpegSettings]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname,
  );

  // Unload HLS when navigating away
  useEffect(() => {
    console.log(blocker.state);
    if (blocker.state === 'blocked') {
      if (videoRef.current) {
        videoRef.current.pause();
      }

      if (hls) {
        hls.detachMedia();
        hls.destroy();
      }

      blocker.proceed();
    }
  }, [blocker, hls, videoRef]);

  const attachMedia = () => {
    const video = videoRef.current;
    if (hls && video) {
      setLoadedStream(true);
      apiClient
        .startHlsStream({ params: { channelNumber } })
        .then(({ streamPath }) => {
          hls.loadSource(`http://localhost:8000${streamPath}`);
          hls.attachMedia(video);
        })
        .catch((err) => {
          console.error('Unable to fetch stream URL', err);
          setLoadedStream(
            isError(err) ? err : new Error('Unable to fetch stream url'),
          );
        });
    }
  };

  const reloadStream = useCallback(() => {
    if (hls && videoRef.current) {
      hls.detachMedia();
      setLoadedStream(false);
      attachMedia();
    }
  }, [hls, resetHls, setLoadedStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && hls && canLoadStream) {
      attachMedia();
    }
  }, [videoRef, hls, canLoadStream, setLoadedStream, channelNumber]);

  useEffect(() => {
    resetHls();
    setLoadedStream(false);
  }, [channelNumber, resetHls]);

  const renderVideo = () => {
    if (!hlsSupported) {
      return <Alert severity="error">HLS not supported in this browser!</Alert>;
    }

    if (!isNil(ffmpegSettings) && ffmpegSettings.audioEncoder === 'ac3') {
      return (
        <Alert severity="warning">
          Tunarr is currently configured to use the AC3 audio encoder. This
          audio format is not supported by browsers. The resultant stream will
          likely not have audio or will not play at all.
        </Alert>
      );
    }

    return (
      <Box>
        <Box
          component="div"
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 100000000,
            display: lightsOff ? 'block' : 'none',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
          }}
        />
        <Box sx={{ position: 'relative', zIndex: 200000000 }}>
          <video style={{ width: '1080px' }} controls autoPlay ref={videoRef} />
          <Button onClick={() => reloadStream()}>Reload</Button>
          <StandaloneToggleButton
            selected={lightsOff}
            onToggle={() => setLightsOff(toggle)}
          >
            <Lightbulb
              sx={{
                color: (theme) =>
                  lightsOff ? 'currentColor' : theme.palette.warning.light,
              }}
            />
          </StandaloneToggleButton>
        </Box>
      </Box>
    );
  };

  return <Box>{renderVideo()}</Box>;
}
