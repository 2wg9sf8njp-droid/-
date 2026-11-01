// 空・霧・太陽光・昼夜サイクル
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/rng.js';

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 900;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xc4d4e0, 0x5a5440, 0.9);
    scene.add(this.hemi);
    this.fog = new THREE.Fog(0xb8c4c8, 250, 1500);
    scene.fog = this.fog;

    const skyGeo = new THREE.SphereGeometry(2600, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x6f8fae) },
        horizon: { value: new THREE.Color(0xc8d0cc) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunCol: { value: new THREE.Color(0xfff0d0) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, -0.2, 1.0); vec3 c = mix(horizon, top, pow(max(h,0.0), 0.55));
        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        c += sunCol * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    this._c = { dayTop: new THREE.Color(0x6f8fae), dayHor: new THREE.Color(0xc4ccc8), duskTop: new THREE.Color(0x44526e), duskHor: new THREE.Color(0xd9a27a), nightTop: new THREE.Color(0x0c1220), nightHor: new THREE.Color(0x26303e) };
  }

  // hour: 0-24
  update(hour, target, camera, viewDist) {
    const ang = ((hour - 6) / 12) * Math.PI; // 6時に日の出、18時に日没
    const elev = Math.sin(ang);
    const az = 0.6;
    const dir = new THREE.Vector3(Math.cos(ang) * Math.cos(az), Math.max(elev, -0.3), Math.cos(ang) * Math.sin(az)).normalize();
    const day = smoothstep(-0.12, 0.25, elev);
    const dusk = clamp(1 - Math.abs(elev) / 0.3, 0, 1);
    const c = this._c;
    const top = c.nightTop.clone().lerp(c.dayTop, day).lerp(c.duskTop, dusk * 0.4);
    const hor = c.nightHor.clone().lerp(c.dayHor, day).lerp(c.duskHor, dusk * 0.55);
    this.skyMat.uniforms.top.value.copy(top);
    this.skyMat.uniforms.horizon.value.copy(hor);
    this.skyMat.uniforms.sunDir.value.copy(dir);
    this.fog.color.copy(hor);
    this.sky.position.copy(camera.position);

    // 夜は月明かり（反対方向から弱い青白い光）
    const lightDir = elev > -0.05 ? dir : dir.clone().negate().setY(0.6).normalize();
    this.sun.intensity = elev > -0.05 ? 0.3 + 1.8 * day : 0.3;
    this.sun.color.set(0xfff1dc).lerp(new THREE.Color(0xffb27a), dusk * 0.6);
    if (elev <= -0.05) this.sun.color.set(0x8fa4c8);
    this.hemi.intensity = 0.2 + 0.55 * day;
    this.hemi.color.copy(hor).lerp(new THREE.Color(0xffffff), 0.3);

    const ext = clamp(viewDist * 0.9, 50, 260);
    const sc = this.sun.shadow.camera;
    if (sc.right !== ext) {
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
      sc.updateProjectionMatrix();
    }
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(lightDir, 400);
    this.fog.near = 200 + viewDist * 0.6;
    this.fog.far = 1300 + viewDist * 1.5;
    return { day, elev };
  }
}
