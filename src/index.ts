import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// 场景设置
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x444444); // 深灰色背景

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// 创建网格
const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0x666666);
scene.add(gridHelper);

// 轨道控制器
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// 光照
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

// 电荷类
class Charge {
  mesh: THREE.Group;
  sphere: THREE.Mesh;
  text: THREE.Mesh | any;
  isPositive: boolean;
  position: THREE.Vector3;

  constructor(isPositive: boolean, position: THREE.Vector3) {
    this.isPositive = isPositive;
    this.position = position.clone();
    this.mesh = new THREE.Group();

    // 创建球体
    const geometry = new THREE.SphereGeometry(0.3, 32, 32);
    const material = new THREE.MeshPhongMaterial({
      color: isPositive ? 0xff4444 : 0x4444ff
    });
    this.sphere = new THREE.Mesh(geometry, material);
    this.mesh.add(this.sphere);

    // 创建文字
    this.createText();

    this.mesh.position.copy(position);
    scene.add(this.mesh);
  }

  createText() {
    if (this.text) {
      this.mesh.remove(this.text);
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 64;
    canvas.height = 64;

    context.fillStyle = 'white';
    context.font = 'bold 48px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(this.isPositive ? '+' : '-', 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    this.text = new THREE.Sprite(material) as any;
    this.text.scale.set(0.8, 0.8, 1);
    this.text.position.set(0, 0, 0.4);
    this.mesh.add(this.text);
  }

  toggleCharge() {
    this.isPositive = !this.isPositive;
    (this.sphere.material as THREE.MeshPhongMaterial).color.setHex(
      this.isPositive ? 0xff4444 : 0x4444ff
    );
    this.createText();
  }

  setPosition(position: THREE.Vector3) {
    this.position.copy(position);
    this.mesh.position.copy(position);
  }
}

// 创建两个电荷
const charge1 = new Charge(true, new THREE.Vector3(-3, 0, 0));
const charge2 = new Charge(false, new THREE.Vector3(3, 0, 0));

// 创建连接线
const lineGeometry = new THREE.BufferGeometry().setFromPoints([
  charge1.position, charge2.position
]);
const lineMaterial = new THREE.LineDashedMaterial({
  color: 0xaaaaaa,
  dashSize: 0.2,
  gapSize: 0.1
});
const line = new THREE.Line(lineGeometry, lineMaterial);
line.computeLineDistances();
scene.add(line);

// 更新连接线
function updateLine() {
  const positions = new Float32Array([
    charge1.position.x, charge1.position.y, charge1.position.z,
    charge2.position.x, charge2.position.y, charge2.position.z
  ]);
  line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  line.computeLineDistances();
}

// 射线投射器
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// 拖拽状态
let isDragging = false;
let dragTarget: Charge | null = null;
let dragOffset = new THREE.Vector3();

// 获取鼠标/触摸位置
function getPointerPosition(event: MouseEvent | Touch): THREE.Vector2 {
  return new THREE.Vector2(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1
  );
}

// 检测电荷碰撞
function getChargeAtPosition(pointer: THREE.Vector2): Charge | null {
  raycaster.setFromCamera(pointer, camera);
  const charges = [charge1, charge2];

  for (const charge of charges) {
    const intersects = raycaster.intersectObject(charge.sphere);
    if (intersects.length > 0) {
      return charge;
    }
  }
  return null;
}

// 将3D位置约束到直线上
function constrainToLine(position: THREE.Vector3): THREE.Vector3 {
  const lineDirection = new THREE.Vector3().subVectors(charge2.position, charge1.position).normalize();
  const lineStart = charge1.position.clone();
  const toPoint = new THREE.Vector3().subVectors(position, lineStart);
  const projection = toPoint.dot(lineDirection);
  return lineStart.clone().add(lineDirection.multiplyScalar(projection));
}

// 鼠标事件
let lastClickTime = 0;
let clickTarget: Charge | null = null;

renderer.domElement.addEventListener('mousedown', (event) => {
  mouse.copy(getPointerPosition(event));
  const charge = getChargeAtPosition(mouse);

  if (charge) {
    const currentTime = Date.now();
    if (clickTarget === charge && currentTime - lastClickTime < 300) {
      // 双击切换电荷
      charge.toggleCharge();
    } else {
      // 开始拖拽
      isDragging = true;
      dragTarget = charge;
      controls.enabled = false;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(charge.sphere);
      if (intersects.length > 0) {
        dragOffset.copy(intersects[0].point).sub(charge.position);
      }
    }

    clickTarget = charge;
    lastClickTime = currentTime;
  } else {
    clickTarget = null;
  }
});

renderer.domElement.addEventListener('mousemove', (event) => {
  if (isDragging && dragTarget) {
    mouse.copy(getPointerPosition(event));
    raycaster.setFromCamera(mouse, camera);

    // 在Z=0平面上投射
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersection);

    if (intersection) {
      const newPosition = intersection.sub(dragOffset);
      const constrainedPosition = constrainToLine(newPosition);
      dragTarget.setPosition(constrainedPosition);
      updateLine();
    }
  }
});

renderer.domElement.addEventListener('mouseup', () => {
  isDragging = false;
  dragTarget = null;
  controls.enabled = true;
});

// 触摸事件
renderer.domElement.addEventListener('touchstart', (event) => {
  event.preventDefault();
  if (event.touches.length === 1) {
    const touch = event.touches[0];
    mouse.copy(getPointerPosition(touch));
    const charge = getChargeAtPosition(mouse);

    if (charge) {
      isDragging = true;
      dragTarget = charge;
      controls.enabled = false;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(charge.sphere);
      if (intersects.length > 0) {
        dragOffset.copy(intersects[0].point).sub(charge.position);
      }
    }
  }
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (event) => {
  event.preventDefault();
  if (isDragging && dragTarget && event.touches.length === 1) {
    const touch = event.touches[0];
    mouse.copy(getPointerPosition(touch));
    raycaster.setFromCamera(mouse, camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersection);

    if (intersection) {
      const newPosition = intersection.sub(dragOffset);
      const constrainedPosition = constrainToLine(newPosition);
      dragTarget.setPosition(constrainedPosition);
      updateLine();
    }
  }
}, { passive: false });

renderer.domElement.addEventListener('touchend', (event) => {
  event.preventDefault();
  isDragging = false;
  dragTarget = null;
  controls.enabled = true;
}, { passive: false });

// 窗口调整
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 渲染循环
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();
