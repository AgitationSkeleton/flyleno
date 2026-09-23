// First-person views from the host's head.
//   human eyes - an ordinary perspective camera at Leno's eyes, with a human field of view
//   fly eyes   - what a fruit fly's compound eyes take in: a panorama of ~320 degrees (a blind wedge straight
//                behind), resolved into hexagonal facets of ~5 degrees (Drosophila has ~780 ommatidia per eye with
//                ~5 degree acceptance angles), and weak in red (fly photoreceptors barely respond to red light,
//                so a red set looks dark to it). Rendered from a small cube map at the eye, projected by a shader.
import * as THREE from 'three';

const AZ_MAX = 160 * Math.PI / 180;            // each eye reaches 160 degrees back from straight ahead
const FACET = 5 * Math.PI / 180;               // ommatidial spacing

export class FlyEyeView {
  constructor(size = 96) {
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
    this.cubeCam = new THREE.CubeCamera(0.02, 400, this.rt);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      tCube: { value: this.rt.texture }, uRot: { value: new THREE.Matrix3() },
      uAspect: { value: 1 }, uAzMax: { value: AZ_MAX }, uFacet: { value: FACET },
    };
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthTest: false, depthWrite: false,
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform samplerCube tCube; uniform mat3 uRot; uniform float uAspect, uAzMax, uFacet;
        varying vec2 vUv;
        // direction in head space for azimuth (+ = left) / elevation; the head looks along +Z
        vec3 dirOf(float az, float el) { return vec3(sin(az) * cos(el), sin(el), cos(az) * cos(el)); }
        void main() {
          // equirectangular panorama: x spans -AZ..+AZ, y keeps the same degrees per pixel (clamped to +-90)
          vec2 p = vUv * 2.0 - 1.0;
          float az = -p.x * uAzMax;
          float el = p.y * uAzMax / uAspect;
          if (abs(el) > 1.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          // hexagonal ommatidial lattice in (az, el): nearest of two offset rectangular lattices
          vec2 q = vec2(az, el) / uFacet;
          vec2 r = vec2(1.0, 1.7320508);
          vec2 a = mod(q, r) - r * 0.5, b = mod(q - r * 0.5, r) - r * 0.5;
          vec2 gv = dot(a, a) < dot(b, b) ? a : b;            // offset from the facet centre (facet units)
          vec2 c = (q - gv) * uFacet;                          // the facet centre (az, el)
          vec3 col = textureCube(tCube, uRot * dirOf(c.x, clamp(c.y, -1.55, 1.55))).rgb;
          col = vec3(col.r * 0.35, col.g, col.b * 1.1);        // weak in red
          // each facet slightly bright in the middle, dark rims between them
          float d = length(gv);
          col *= mix(1.08, 0.55, smoothstep(0.32, 0.5, d));
          // the two eyes meet in front (a faint seam); the blind wedge behind; dimmer toward the eyes' edges
          col *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.015, abs(az)));
          float edge = smoothstep(uAzMax - 0.25, uAzMax, abs(az)) + smoothstep(1.25, 1.5, abs(el));
          col *= 1.0 - clamp(edge, 0.0, 1.0);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
  }

  /** render the fly's view from `pos` with head orientation `quat` */
  render(renderer, scene, pos, quat, aspect) {
    this.cubeCam.position.copy(pos);
    this.cubeCam.update(renderer, scene);
    this.uniforms.uRot.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quat));
    this.uniforms.uAspect.value = aspect;
    renderer.render(this.quadScene, this.quadCam);
  }
}

/** vertical field of view (degrees) for a human's ~110 degree horizontal view at this aspect ratio */
export function humanFov(aspect) {
  const h = 110 * Math.PI / 180;
  return Math.min(100, 2 * Math.atan(Math.tan(h / 2) / aspect) * 180 / Math.PI);
}
