import * as Babylon from 'babylonjs';
import 'babylonjs-loaders';
// import Oimo = require('babylonjs/Oimo');
import Ammo = require('./ammo');
import { VisibleSensor } from './sensors/sensor';
import { ETSensorBabylon } from './sensors/etSensorBabylon';
import { RobotState } from './RobotState';

const noGravity = new Babylon.Vector3(0,0,0);
const fullGravity = new Babylon.Vector3(0,-9.8 * 10,0);

export class Space {
  private engine: Babylon.Engine;
  private canvas: HTMLCanvasElement;
  private scene: Babylon.Scene;

  private gravitySet = (g) => this.scene.getPhysicsEngine().setGravity(g);

  private ground: Babylon.Mesh;
  private mat: Babylon.Mesh;

  private bodyCompoundRootMesh: Babylon.AbstractMesh;
  
  // Use for changing robot position 
  private botMover: Babylon.Vector3;
  private robotWorldRotation: number;

  private leftWheelJoint: Babylon.MotorEnabledJoint;
  private rightWheelJoint: Babylon.MotorEnabledJoint;

  // TODO: Associate each sensor with an update frequency, since we may update different sensors at different speeds
  private etSensorFake: VisibleSensor;
  private etSensorArm: VisibleSensor;
  private ticksSinceETSensorUpdate: number;

  private can: Babylon.Mesh;
  private canCoordinates: Array<[number, number]>;

  private collidersVisible = false;

  private readonly TICKS_BETWEEN_ET_SENSOR_UPDATES = 15;

  private getRobotState: () => RobotState;
  private updateRobotState: (robotState: Partial<RobotState>) => void;

  // TODO: Find a better way to communicate robot state instead of these callbacks
  constructor(canvas: HTMLCanvasElement, getRobotState: () => RobotState, updateRobotState: (robotState: Partial<RobotState>) => void) {
    this.canvas = canvas;
    this.engine = new Babylon.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Babylon.Scene(this.engine);

    this.getRobotState = getRobotState;
    this.updateRobotState = updateRobotState;

    this.ticksSinceETSensorUpdate = 0;
  }

  public createScene(): void {
    const camera = new Babylon.ArcRotateCamera("botcam",10,10,10, new Babylon.Vector3(50,50,50), this.scene);
    camera.setTarget(Babylon.Vector3.Zero());
    camera.attachControl(this.canvas, true);

    const light = new Babylon.HemisphericLight("botlight", new Babylon.Vector3(0,1,0), this.scene);
    light.intensity = 0.75;

    // At 100x scale, gravity should be -9.8 * 100, but this causes weird jitter behavior
    // Full gravity will be -9.8 * 10
    // Start gravity lower (1/10) so that any initial changes to robot don't move it as much
    this.scene.enablePhysics(noGravity, new Babylon.AmmoJSPlugin(true, Ammo));

    this.buildFloor();

    // (x, z) coordinates of cans around the board
    this.canCoordinates = [[-22, -14.3], [0, -20.6], [15.5, -23.7], [0, -6.9], [-13.7, 6.8], [0, 6.8], [13.5, 6.8], [25.1, 14.8], [0, 34], [-18.8, 45.4], [0, 54.9], [18.7, 45.4]];

    // Logic that happens before every frame
    this.scene.registerBeforeRender(() => {
      let didUpdateFakeETSensor = false;
      let didUpdateArmETSensor = false;

      // If visualization is on, update ET sensor visual
      if (this.etSensorFake.isVisible) {
        this.etSensorFake.update();
        this.etSensorFake.updateVisual();
        didUpdateFakeETSensor = true;
      }

      if (this.etSensorArm?.isVisible) {
        this.etSensorArm.update();
        this.etSensorArm.updateVisual();
        didUpdateArmETSensor = true;
      }

      // If 30 frames have passed since last sensor update, update ET sensor value
      if (this.ticksSinceETSensorUpdate >= this.TICKS_BETWEEN_ET_SENSOR_UPDATES) {
        // Update ET sensor if we didn't already update it earlier
        if (!didUpdateFakeETSensor) {
          this.etSensorFake.update();
          didUpdateFakeETSensor = true;
        }

        if (this.etSensorArm && !didUpdateArmETSensor) {
          this.etSensorArm.update();
          didUpdateArmETSensor = true;
        }

        // Update robot state with new ET sensor value
        const currRobotState = this.getRobotState();
        const a0 = this.etSensorFake.getValue();
        const a1 = this.etSensorArm ? this.etSensorArm.getValue() : currRobotState.analogValues[1];
        this.updateRobotState({ analogValues: [a0, a1, 0, 0, 0, 0] });

        this.ticksSinceETSensorUpdate = 0;
      } else {
        this.ticksSinceETSensorUpdate++;
      }
    });
  }
  

  public async loadMeshes(): Promise<void> {
    this.gravitySet(noGravity);

    // Set robot to specified position
    this.botMover = new Babylon.Vector3(0 + this.getRobotState().x, 0.5 + this.getRobotState().y, -37 + this.getRobotState().z); // start robot slightly above to keep from shifting in mat material
    this.robotWorldRotation = this.getRobotState().theta * Math.PI / 180;

    // Load model into scene
    const importMeshResult = await Babylon.SceneLoader.ImportMeshAsync("",'static/', 'Simulator_Demobot_colliders.glb', this.scene);

    // TEMP FIX: Scale everything up by 100 to avoid Ammo issues at small scale
    const rootMesh = importMeshResult.meshes.find(mesh => mesh.name === '__root__');
    rootMesh.scaling.scaleInPlace(100);

    // Also have to apply transformations to 'Root' node b/c when visual transform nodes are unparented, they lose their transformations
    // (seems to be fixed in Babylon 5 alpha versions)

    this.scene.getTransformNodeByName('Root').setAbsolutePosition(new Babylon.Vector3(0,5.7,0).add(this.botMover));
    this.scene.getTransformNodeByName('Root').scaling.scaleInPlace(100);
    
    // Hide collider meshes (unless enabled for debugging)
    importMeshResult.meshes.forEach(mesh => {
      if (mesh.name.startsWith('collider')) {
        mesh.visibility = 0.6;
        mesh.isVisible = this.collidersVisible;
      }
    });

    // Create the root mesh for the body compound
    // We need this so that we can set a specific center of mass for the whole body
    // For now, use the wallaby collider location as the center of mass
    const wallabyColliderMesh = this.scene.getMeshByName('collider_wallaby');
    wallabyColliderMesh.computeWorldMatrix(true);
    this.bodyCompoundRootMesh = new Babylon.Mesh("bodyCompoundMesh", this.scene);
    this.bodyCompoundRootMesh.position = wallabyColliderMesh.getAbsolutePosition().add(this.botMover);

    type ColliderShape = 'box' | 'sphere';
    const bodyColliderMeshInfos: [string, ColliderShape][] = [
      ['collider_arm_claw_1', 'box'],
      ['collider_arm_claw_2', 'box'],
      ['collider_arm_claw_3', 'box'],
      ['collider_claw_1', 'box'],
      ['collider_claw_2', 'box'],
      ['collider_claw_3', 'box'],
      ['collider_claw_servo', 'box'],
      ['collider_body', 'box'],
      ['collider_body_back_panel', 'box'],
      ['collider_body_front_panel', 'box'],
      ['collider_body_front_legos', 'box'],
      ['collider_caster', 'sphere'],
      ['collider_touch_back_left', 'box'],
      ['collider_touch_back_right', 'box'],
      ['collider_touch_front', 'box'],
      ['collider_wallaby', 'box'],
      ['collider_battery', 'box'],
      ['collider_arm_servo', 'box'],
    ];

    // Parent body collider meshes to body root and add physics impostors
    for (const [bodyColliderMeshName, bodyColliderShape] of bodyColliderMeshInfos) {
      const colliderMesh: Babylon.AbstractMesh = this.scene.getMeshByName(bodyColliderMeshName);
      if (!colliderMesh) {
        throw new Error(`failed to find collider mesh in model: ${bodyColliderMeshName}`);
      }
      
      // Unparent collider mesh before adding physics impostors to them
      colliderMesh.setParent(null);
      
      const impostorType = bodyColliderShape === 'box'
        ? Babylon.PhysicsImpostor.BoxImpostor
        : Babylon.PhysicsImpostor.SphereImpostor;
      colliderMesh.physicsImpostor = new Babylon.PhysicsImpostor(colliderMesh, impostorType, { mass: 0 }, this.scene);
      
      colliderMesh.setParent(this.bodyCompoundRootMesh);
      colliderMesh.setAbsolutePosition(colliderMesh.absolutePosition.add(this.botMover));
    }

    // Find wheel collider meshes in scene
    const colliderLeftWheelMesh: Babylon.AbstractMesh = this.scene.getMeshByName('collider_left_wheel');
    const colliderRightWheelMesh: Babylon.AbstractMesh = this.scene.getMeshByName('collider_right_wheel');

    // Unparent wheel collider meshes before adding physics impostors to them
    colliderLeftWheelMesh.setParent(null);
    colliderRightWheelMesh.setParent(null);

    colliderLeftWheelMesh.setAbsolutePosition(colliderLeftWheelMesh.absolutePosition.add(this.botMover));
    colliderRightWheelMesh.setAbsolutePosition(colliderRightWheelMesh.absolutePosition.add(this.botMover));

    // Find transform nodes (visual meshes) in scene and parent them to the proper node
    this.scene.getTransformNodeByName('ChassisWombat-1').setParent(this.bodyCompoundRootMesh);
    this.scene.getTransformNodeByName('KIPR_Lower_final_062119-1').setParent(this.bodyCompoundRootMesh);
    this.scene.getTransformNodeByName('1 x 5 Servo Horn-1').setParent(this.bodyCompoundRootMesh);
    this.scene.getTransformNodeByName('1 x 5 Servo Horn-2').setParent(this.bodyCompoundRootMesh);
    this.scene.getTransformNodeByName('Servo Wheel-1').setParent(colliderRightWheelMesh);
    this.scene.getTransformNodeByName('Servo Wheel-2').setParent(colliderLeftWheelMesh);

    // Rotate meshes for any user input
    this.bodyCompoundRootMesh.rotate(Babylon.Axis.Y,this.robotWorldRotation);
    colliderRightWheelMesh.rotate(Babylon.Axis.Z,this.robotWorldRotation);
    colliderLeftWheelMesh.rotate(Babylon.Axis.Z,-this.robotWorldRotation);
    
    // Set physics impostors for root nodes
    this.bodyCompoundRootMesh.physicsImpostor = new Babylon.PhysicsImpostor(this.bodyCompoundRootMesh, Babylon.PhysicsImpostor.NoImpostor, { mass: 100, friction: 0.1 }, this.scene);
    colliderLeftWheelMesh.physicsImpostor = new Babylon.PhysicsImpostor(colliderLeftWheelMesh, Babylon.PhysicsImpostor.CylinderImpostor, { mass: 10, friction: 1 }, this.scene);
    colliderRightWheelMesh.physicsImpostor = new Babylon.PhysicsImpostor(colliderRightWheelMesh, Babylon.PhysicsImpostor.CylinderImpostor, { mass: 10, friction: 1 }, this.scene);
    
    

    // Create joint for right wheel
    const rightWheelMainPivot = colliderRightWheelMesh.position.subtract(this.bodyCompoundRootMesh.position);
    this.rightWheelJoint = new Babylon.MotorEnabledJoint(Babylon.PhysicsJoint.HingeJoint, {
      mainPivot: rightWheelMainPivot,
      connectedPivot: new Babylon.Vector3(0, 0, 0),
      mainAxis: new Babylon.Vector3(1, 0, 0),
      connectedAxis: new Babylon.Vector3(0, -1, 0),
    });
    this.bodyCompoundRootMesh.physicsImpostor.addJoint(colliderRightWheelMesh.physicsImpostor, this.rightWheelJoint);

    // Create joint for left wheel
    const leftWheelMainPivot = colliderLeftWheelMesh.position.subtract(this.bodyCompoundRootMesh.position);
    this.leftWheelJoint = new Babylon.MotorEnabledJoint(Babylon.PhysicsJoint.HingeJoint, {
      mainPivot: leftWheelMainPivot,
      connectedPivot: new Babylon.Vector3(0, 0, 0),
      mainAxis: new Babylon.Vector3(-1, 0, 0),
      connectedAxis: new Babylon.Vector3(0, 1, 0),
    });
    this.bodyCompoundRootMesh.physicsImpostor.addJoint(colliderLeftWheelMesh.physicsImpostor, this.leftWheelJoint);

    // Create ET sensors, positioned relative to other meshes
    const etSensorMesh = this.scene.getMeshByID('black satin finish plastic');
    this.etSensorArm = new ETSensorBabylon(this.scene, etSensorMesh, new Babylon.Vector3(0.0, 0.02, 0.0), new Babylon.Vector3(0.02, 0.02, -0.015), { isVisible: true });
    this.etSensorFake = new ETSensorBabylon(this.scene, this.bodyCompoundRootMesh, new Babylon.Vector3(0, 0, 18), new Babylon.Vector3(0, 0, 18), { isVisible: true });
    
    
    // this.bodyCompoundRootMesh.setAbsolutePosition(this.bodyCompoundRootMesh.absolutePosition.addInPlaceFromFloats(0,5,0));
    
    
    await this.scene.whenReadyAsync();
    
    this.scene.registerAfterRender(() => {
      const currRobotState = this.getRobotState();

      // Set simulator motor speeds based on robot state
      this.setDriveMotors(currRobotState.motorSpeeds[0], currRobotState.motorSpeeds[3]);

      // Calculate new motor positions based on motor speed
      // TODO: Get actual wheel rotation instead of calculating position from speed
      const engineDeltaSeconds = this.scene.getEngine().getDeltaTime() / 1000;
      const m0Position = currRobotState.motorPositions[0] + currRobotState.motorSpeeds[0] * engineDeltaSeconds;
      const m3Position = currRobotState.motorPositions[3] + currRobotState.motorSpeeds[3] * engineDeltaSeconds;

      this.updateRobotState({
        motorPositions: [m0Position, 0, 0, m3Position],
      });

      // const s0_position = Math.round((this.getRobotState().servo0_position / 11.702) - 87.5);
      // const angle_servoArm = Math.round(Babylon.Tools.ToDegrees(this.servoArmMotor.rotationQuaternion.toEulerAngles()._x));
      // console.log(`position: ${this.getRobotState().servo0_position} Calculated position: ${s0_position} Servo Angle: ${angle_servoArm}`);
      // // console.log(Math.round(Babylon.Tools.ToDegrees(this.servoArmMotor.rotationQuaternion.toEulerAngles()._x)));

      // if (s0_position > angle_servoArm) {
      //   this.setnegativeServo(s0_position);
      // } else if (s0_position < angle_servoArm) {
      //   this.setpositiveServo(s0_position);
      // } else if (s0_position === angle_servoArm) {
      //   this.liftArm_joint.setMotor(0);
      // } else {
      //   // do something
      // }
      // this.liftClaw_joint.setMotor(0.3);
      

      // if(this.registers_[61] == 0){
      //   s1 = WorkerInstance.readServoRegister(WorkerInstance.registers[78], WorkerInstance.registers[79]);
      //   s3 = WorkerInstance.readServoRegister(WorkerInstance.registers[80], WorkerInstance.registers[81]);
      // }
    });
  }
  

  public startRenderLoop(): void {
    this.scene.executeOnceBeforeRender(() => this.gravitySet(fullGravity),500);
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
  }

  public stopRenderLoop(): void {
    this.engine.stopRenderLoop();
  }

  public destroyBot(): void {
    this.scene.getMeshByName('collider_left_wheel').dispose();
    this.scene.getMeshByName('collider_right_wheel').dispose();
    this.etSensorArm.isVisible = false;
    this.etSensorFake.isVisible = false;
    this.etSensorArm.dispose();
    this.etSensorFake.dispose();
    this.scene.getMeshByName('bodyCompoundMesh').dispose();
    this.scene.getTransformNodeByName('Root').dispose();
    this.robotWorldRotation = 0;
    
    this.updateRobotState({
      mesh:true,
    });
  }

  public handleResize(): void {
    this.engine.resize();
  }

  public createCan(canNumber: number): void {
    const canName = `Can${canNumber}`;
    const new_can = Babylon.MeshBuilder.CreateCylinder(canName,{ height:10, diameter:6 }, this.scene);
    new_can.physicsImpostor = new Babylon.PhysicsImpostor(new_can, Babylon.PhysicsImpostor.CylinderImpostor, { mass: 10, friction: 5 }, this.scene);
    new_can.position = new Babylon.Vector3(this.canCoordinates[canNumber - 1][0], 5, this.canCoordinates[canNumber - 1][1]);
  }

  public destroyCan(canNumber: number): void {
    const canName = `Can${canNumber}`;
    this.scene.getMeshByName(canName).dispose();
  }

  private buildFloor() {
    this.mat = Babylon.MeshBuilder.CreateGround("mat", { width:118, height:59, subdivisions:2 }, this.scene);
    this.mat.position.y = -0.8;
    this.mat.rotate(new Babylon.Vector3(0,1,0),-Math.PI / 2);
    const matMaterial = new Babylon.StandardMaterial("ground", this.scene);
    matMaterial.ambientTexture = new Babylon.Texture('static/Surface-A.png',this.scene);
    this.mat.material = matMaterial;
    this.mat.physicsImpostor = new Babylon.PhysicsImpostor(this.mat, Babylon.PhysicsImpostor.BoxImpostor,{ mass:0, friction: 1 }, this.scene);

    this.ground = Babylon.MeshBuilder.CreateGround("ground", { width:354, height:354, subdivisions:2 }, this.scene);
    this.ground.position.y = -0.83;
    const groundMaterial = new Babylon.StandardMaterial("ground", this.scene);
    groundMaterial.emissiveColor = new Babylon.Color3(0.1,0.1,0.1);
    this.ground.material = groundMaterial;
    this.ground.physicsImpostor = new Babylon.PhysicsImpostor(this.ground, Babylon.PhysicsImpostor.BoxImpostor,{ mass:0, friction: 1 }, this.scene);
  }

  private setDriveMotors(leftSpeed: number, rightSpeed: number) {
    // One motor is negative because the wheel joints are created on opposite axes,
    // so one needs to turn "backwards" for them to turn in the same direction
    this.leftWheelJoint.setMotor(leftSpeed / 1500 * 5);
    this.rightWheelJoint.setMotor(-rightSpeed / 1500 * 5);
  }

  // private setpositiveServo(s0_position: number) {
  //   this.liftArm_joint.setMotor(0.3); // Rotates arm backwards

  //   const angle_Positive = Babylon.Tools.ToDegrees(this.servoArmMotor.rotationQuaternion.toEulerAngles()._x);
  //   if (s0_position  > angle_Positive || angle_Positive > 85 || angle_Positive < -85) {
  //     this.liftArm_joint.setMotor(0);
  //   }
  // }

  // private setnegativeServo(s0_position: number) {
  //   this.liftArm_joint.setMotor(-0.3); // Rotates arm forward

  //   const angle_Negative = Babylon.Tools.ToDegrees(this.servoArmMotor.rotationQuaternion.toEulerAngles()._x);
  //   if (s0_position < angle_Negative || angle_Negative < -85 || angle_Negative > 85) {
  //     this.liftArm_joint.setMotor(0);
  //   }
  // }
}
