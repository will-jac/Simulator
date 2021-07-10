import * as React from 'react';
import WorkerInstance from '../WorkerInstance';
import { RobotState } from '../RobotState';

import { SurfaceState, SurfaceStatePresets } from '../SurfaceState';
import Menu from './Menu';

import { styled } from 'styletron-react';
import { DARK, Theme } from './theme';
import OverlayLayout from './OverlayLayout';
import { Layout, LayoutProps } from './Layout';
import BottomLayout from './BottomLayout';
import SideLayout from './SideLayout';

import { SimulatorArea } from './SimulatorArea';
import { Portal } from './Portal';
import { SettingsDialog } from './SettingsDialog';
import { AboutDialog } from './AboutDialog';
import compile, { CompileError } from '../compile';
import { SimulatorState } from './SimulatorState';
import { StyledText } from '../util';
import { Message } from 'ivygate';
import parseMessages, { hasErrors, sort, toStyledText } from '../util/parse-messages';

import {
  Items,
} from '../items';

type ModalType = 'settings' | 'about' | 'none';

interface RootState {
  shouldSetRobotPosition: boolean,
  isSensorNoiseEnabled: boolean,
  surfaceState: SurfaceState,
  robotState: RobotState;
  items: boolean[];
  layout: Layout;
  code: string;
  simulatorSink: Portal.Sink;

  simulatorState: SimulatorState;

  modal: ModalType;

  console: StyledText;
  messages: Message[];

  theme: Theme;
}

type Props = Record<string, never>;
type State = RootState;

const Container = styled('div', {
  width: '100vw',
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
});

const STDOUT_STYLE = (theme: Theme) => ({
  color: theme.color
});

const STDERR_STYLE = (theme: Theme) => ({
  color: 'red'
});

const ITEM_KEYS = Object.keys(Items);

export class Root extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);

    

    this.state = {
      robotState: WorkerInstance.state,
      shouldSetRobotPosition: false,
      isSensorNoiseEnabled: false,
      surfaceState: SurfaceStatePresets.jbcA,
      items: Array<boolean>(ITEM_KEYS.length).fill(false),
      layout: Layout.Overlay,
      code: '',
      simulatorSink: undefined,
      modal: 'none',
      simulatorState: SimulatorState.STOPPED,
      console: StyledText.text({ text: 'Welcome to the KIPR Simulator!\n', style: STDOUT_STYLE(DARK) }),
      theme: DARK,
      messages: []
    };
  }

  componentDidMount() {
    WorkerInstance.onStateChange = this.onWorkerStateChange_;
    WorkerInstance.onStdOutput = this.onStdOutput_;
    WorkerInstance.onStdError = this.onStdError_;
  }

  private onRobotStateUpdate_ = (robot: Partial<RobotState>) => {
    // Create new robot state object by applying the partial changes
    const newRobotState: RobotState = {
      ...this.state.robotState,
      motorSpeeds: [...this.state.robotState.motorSpeeds],
      motorPositions: [...this.state.robotState.motorPositions],
      servoPositions: [...this.state.robotState.servoPositions],
      analogValues: [...this.state.robotState.analogValues],
      ...robot,
    };

    WorkerInstance.state = newRobotState;
  };

  private onItemChange_ = (itemName: string, enabled: boolean) => {
    this.setState(prevState => {
      const items = [...prevState.items];
      items[ITEM_KEYS.indexOf(itemName)] = enabled;
      return { items };
    });
  };

  private onRobotPositionSetRequested_ = () => {
    this.setState({ shouldSetRobotPosition: true });
  };

  private onRobotPositionSetCompleted_ = () => {
    this.setState({ shouldSetRobotPosition: false });
  };
  
  private onToggleSensorNoise_ = (enabled: boolean) => {
    this.setState({ isSensorNoiseEnabled: enabled });
  };

  private onUpdateSurfaceState_ = (newSurfaceName: string) => {
    const newState = SurfaceStatePresets.presets.find(preset => (preset.surfaceName === newSurfaceName));
    this.setState({ surfaceState: newState });
  };


  private onCodeChange_ = (code: string) => {
    this.setState({ code });
  };

  private overlayLayout_: OverlayLayout;
  private bindOverlayLayout_ = (overlayLayout: OverlayLayout) => {
    this.overlayLayout_ = overlayLayout;
  };

  private onShowAll_ = () => {
    this.overlayLayout_.showAll();
  };

  private onHideAll_ = () => {
    this.overlayLayout_.hideAll();
  };
  
  private onLayoutChange_ = (layout: Layout) => {
    this.setState({
      layout
    });
  };

  private onModalClick_ = (modal: ModalType) => () => this.setState({
    modal
  });

  private onModalClose_ = () => this.setState({
    modal: 'none'
  });

  private bindSimulatorSink_ = (simulatorSink: Portal.Sink) => {
    this.setState({
      simulatorSink
    });
  };

  private onWorkerStateChange_ = (robotState: RobotState) => {
    this.setState({
      robotState,
    });
  };

  private onStdOutput_ = (text: string) => {
    this.setState({
      console: StyledText.extend(this.state.console, StyledText.text({
        text,
        style: STDOUT_STYLE(this.state.theme)
      }))
    });
  };

  private onStdError_ = (text: string) => {
    this.setState({
      console: StyledText.extend(this.state.console, StyledText.text({
        text,
        style: STDOUT_STYLE(this.state.theme)
      }))
    });
  };

  private onErrorMessageClick_ = (line: number) => () => {
    if (!this.overlayLayout_) return;
    this.overlayLayout_.editor.ivygate.revealLineInCenter(line);
  };

  private onRunClick_ = () => {
    const { state } = this;
    const { code, console, theme } = state;

    let nextConsole = StyledText.extend(console, StyledText.text({
      text: `Compiling...\n`,
      style: STDOUT_STYLE(this.state.theme)
    }));
    
    this.setState({
      simulatorState: SimulatorState.COMPILING,
      console: nextConsole
    }, () => {
      compile(code)
        .then(js => {
          WorkerInstance.start(js);
          this.setState({
            simulatorState: SimulatorState.RUNNING
          });
        })
        .catch((e: unknown) => {
          /* let nextConsole = console;
          if (typeof e.stderr === 'string' && e.stderr.length > 0) {
            nextConsole = StyledText.extend(console, StyledText.text({
              text: e.stderr,
              style: STDERR_STYLE(theme)
            }));
          }
          if (typeof e.stdout === 'string' && e.stdout.length > 0) {
            nextConsole = StyledText.extend(console, StyledText.text({
              text: e.stdout,
              style: STDOUT_STYLE(theme)
            }));
          }*/

          // TODO: handle cases where e is not a CompileError
          const compileError = e as CompileError;
  
          window.console.log(compileError.stderr);
  
          window.console.log('parse',);
          
          const messages = sort(parseMessages(compileError.stderr));
  
  
          if (hasErrors(messages)) {
            nextConsole = StyledText.extend(nextConsole, StyledText.text({
              text: `Compilation failed.\n`,
              style: STDERR_STYLE(this.state.theme)
            }));
          } else {
            nextConsole = StyledText.extend(nextConsole, StyledText.text({
              text: `Compilation succeeded!\n`,
              style: STDOUT_STYLE(this.state.theme)
            }));
          }
  
          for (const message of messages) {
            nextConsole = StyledText.extend(nextConsole, toStyledText(message, {
              onClick: message.ranges.length > 0
                ? this.onErrorMessageClick_(message.ranges[0].start.line)
                : undefined
            }));
  
          }
  
  
          this.setState({
            simulatorState: SimulatorState.STOPPED,
            messages,
            console: nextConsole
          });
        });
    });
  };

  private onStopClick_ = () => {
    WorkerInstance.stop();
    this.setState({
      simulatorState: SimulatorState.STOPPED
    });
  };

  private onDownloadClick_ = () => {
    const element = document.createElement('a');
    element.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(this.state.code)}`);
    element.setAttribute('download', 'program.c');
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  private onClearConsole_ = () => {
    this.setState({
      console: StyledText.compose({ items: [] })
    });
  };

  render() {
    const { props, state } = this;
    const {
      items,
      robotState,
      layout,
      code,
      simulatorSink,
      modal,
      simulatorState,
      console,
      messages,
      shouldSetRobotPosition,
      isSensorNoiseEnabled,
      surfaceState
    } = state;

    const theme = DARK;

    const commonLayoutProps: LayoutProps = {
      code,
      items,
      onStateChange: this.onRobotStateUpdate_,
      theme,
      state: robotState,
      simulator: this.bindSimulatorSink_,
      onItemChange: this.onItemChange_,
      console,
      onCodeChange: this.onCodeChange_,
      messages,
      onClearConsole: this.onClearConsole_,
      surfaceName: surfaceState.surfaceName,
      onSurfaceChange: this.onUpdateSurfaceState_,
      sensorNoise: isSensorNoiseEnabled,
      onSensorNoiseChange: this.onToggleSensorNoise_,
      onRobotPositionSetRequested: this.onRobotPositionSetRequested_
    };

    let impl: JSX.Element;
    switch (layout) {
      case Layout.Overlay: {
        impl = (
          <OverlayLayout ref={this.bindOverlayLayout_} {...commonLayoutProps} />
        );
        break;
      }
      case Layout.Bottom: {
        impl = (
          <BottomLayout {...commonLayoutProps} />
        );
        break;
      }
      case Layout.Side: {
        impl = (
          <SideLayout {...commonLayoutProps} />
        );
        break;
      }
      default: {
        return null;
      }
      
    }

    return (

      <>
        <Container>
          <Menu
            layout={layout}
            onLayoutChange={this.onLayoutChange_}
            theme={theme}
            onShowAll={this.onShowAll_}
            onHideAll={this.onHideAll_}
            onSettingsClick={this.onModalClick_('settings')}
            onAboutClick={this.onModalClick_('about')}
            onDownloadClick={this.onDownloadClick_}
            onRunClick={this.onRunClick_}
            onStopClick={this.onStopClick_}
            simulatorState={simulatorState}
          />
          {impl}
          <Portal.Source sink={simulatorSink}>
            <SimulatorArea
              key='simulator'
              robotState={robotState}
              itemEnabled={items}
              onRobotStateUpdate={this.onRobotStateUpdate_}
              onRobotPositionSetCompleted={this.onRobotPositionSetCompleted_}
              shouldSetRobotPosition={shouldSetRobotPosition}
              isSensorNoiseEnabled={isSensorNoiseEnabled}
              surfaceState={surfaceState}
            />
          </Portal.Source>
        </Container>
        {modal === 'settings' ? <SettingsDialog theme={theme} onClose={this.onModalClose_} /> : undefined}
        {modal === 'about' ? <AboutDialog theme={theme} onClose={this.onModalClose_} /> : undefined}
      </>

    );
  }
}

// All logic inside of index.tsx
