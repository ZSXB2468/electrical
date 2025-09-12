import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {Line2} from 'three/examples/jsm/lines/Line2.js';
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js';
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js';

// 场景设置
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x444444); // 深灰色背景

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 10);

const renderer = new THREE.WebGLRenderer({antialias: true});
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

// 电场线渲染参数
const FIELD_LINE_WIDTH = 5; // 电场线粗细（像素）
const FIELD_STRENGTH_THRESHOLD = 0.08; // 电场强度阈值，低于此值不显示

// 电场线类
class FieldLine {
    line: Line2;
    points: THREE.Vector3[];
    colors: number[];
    sourceCharge: Charge;

    constructor(sourceCharge: Charge) {
        this.sourceCharge = sourceCharge;
        this.points = [];
        this.colors = [];

        const geometry = new LineGeometry();
        const material = new LineMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            linewidth: FIELD_LINE_WIDTH, // 以像素为单位
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
        });

        this.line = new Line2(geometry, material);
        scene.add(this.line);
    }

    updatePoints(points: THREE.Vector3[], fieldStrengths: number[]) {
        this.points = points;

        // 将 Vector3 数组转换为 Line2 需要的格式
        const positions: number[] = [];
        const colors: number[] = [];

        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            positions.push(point.x, point.y, point.z);

            const strength = fieldStrengths[i] || 0;
            const color = this.getColorFromStrength(strength);
            colors.push(color.r, color.g, color.b);
        }

        this.line.geometry.setPositions(positions);
        this.line.geometry.setColors(colors);
    }

    // 根据电场强度获取颜色
    getColorFromStrength(strength: number): THREE.Color {

        // 使用对数缩放，但调整参数使颜色变化更快
        const logStrength = Math.log10(strength);
        const logThreshold = Math.log10(FIELD_STRENGTH_THRESHOLD);
        const logMax = Math.log10(1); // 降低最大强度阈值，使颜色变化更敏感

        // 将对数值映射到0-1的范围，并增加变化速度
        let normalizedStrength = (logStrength - logThreshold) / (logMax - logThreshold);
        normalizedStrength = Math.min(Math.max(normalizedStrength, 0), 1);

        // 使用幂函数加速颜色变化
        normalizedStrength = Math.pow(normalizedStrength, 0.5); // 平方根函数使变化更快

        // 统一的颜色方案：绿色(120°) -> 黄色(60°) -> 红色(0°)
        const hue = (120 - normalizedStrength * 120) / 360;
        const saturation = 0.8;
        const lightness = 0.4 + normalizedStrength * 0.4; // 在阈值处亮度为0.4，最高为0.8

        return new THREE.Color().setHSL(hue, saturation, lightness);
    }

    dispose() {
        scene.remove(this.line);
        this.line.geometry.dispose();
        (this.line.material as LineMaterial).dispose();
    }
}

// 全局电场线管理器
class FieldLineManager {
    static fieldLines: FieldLine[] = [];

    static clearAllLines() {
        this.fieldLines.forEach(line => line.dispose());
        this.fieldLines = [];
    }

    static generateAllFieldLines() {
        this.clearAllLines();

        const charges = Charge.allCharges;
        if (charges.length < 1) return;

        // 为每个电荷生成电场线
        charges.forEach(charge => {
            this.generateFieldLinesFromCharge(charge, charges);
        });
    }

    static generateFieldLinesFromCharge(sourceCharge: Charge, allCharges: Charge[]) {
        // 在三个正交平面上生成电场线
        const planes = ['xy', 'yz', 'zx']; // 平面类型
        const linesPerPlane = 8; // 每个平面8根电场线

        planes.forEach(plane => {
            for (let i = 0; i < linesPerPlane; i++) {
                const angle = (i / linesPerPlane) * 2 * Math.PI; // 均匀分布在圆周上
                let startDirection;

                // 根据平面类型设置起始方向
                if (plane === 'xy') {
                    startDirection = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
                } else if (plane === 'yz') {
                    startDirection = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle));
                } else if (plane === 'zx') {
                    startDirection = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
                }

                if (!startDirection) continue;
                startDirection.normalize();
                const result = this.calculateFieldLinePath(sourceCharge, startDirection, allCharges);

                if (result.points.length > 1) {
                    const fieldLine = new FieldLine(sourceCharge);
                    fieldLine.updatePoints(result.points, result.strengths);
                    this.fieldLines.push(fieldLine);
                }
            }
        });
    }

    static calculateFieldLinePath(startCharge: Charge, direction: THREE.Vector3, allCharges: Charge[]): {
        points: THREE.Vector3[],
        strengths: number[]
    } {
        const points: THREE.Vector3[] = [];
        const strengths: number[] = [];
        const maxSteps = 200;
        const stepSize = 0.06;
        const maxDistance = 15;

        // 从电荷表面开始
        let currentPos = startCharge.position.clone().add(direction.clone().multiplyScalar(0.4));

        for (let step = 0; step < maxSteps; step++) {
            // 计算当前位置的电场
            const fieldVector = this.calculateElectricFieldAt(currentPos, allCharges);
            const fieldStrength = fieldVector.length();

            // 如果电场强度太弱，停止追踪
            if (fieldStrength < FIELD_STRENGTH_THRESHOLD) break;

            points.push(currentPos.clone());
            strengths.push(fieldStrength);

            // 对于负电荷，电场线方向相反（负电荷的电场线指向自己）
            if (!startCharge.isPositive) {
                fieldVector.negate();
            }

            // 电场线沿电场方��
            fieldVector.normalize().multiplyScalar(stepSize);
            currentPos.add(fieldVector);

            // 检查是否超出边界
            if (currentPos.distanceTo(startCharge.position) > maxDistance) break;

            // 检查是否到达异号电荷
            const nearbyOppositeCharge = allCharges.find(charge =>
                charge.isPositive !== startCharge.isPositive &&
                charge !== startCharge &&
                currentPos.distanceTo(charge.position) < 0.5
            );

            if (nearbyOppositeCharge) {
                // 电场线终止于异号电荷
                points.push(nearbyOppositeCharge.position.clone());
                strengths.push(fieldStrength);
                break;
            }
        }

        return {points, strengths};
    }

    static calculateElectricFieldAt(position: THREE.Vector3, charges: Charge[]): THREE.Vector3 {
        const totalField = new THREE.Vector3();

        charges.forEach(charge => {
            const displacement = new THREE.Vector3().subVectors(position, charge.position);
            const distance = displacement.length();

            // 避免在电荷位置处的奇点
            if (distance < 0.2) return;

            displacement.normalize();

            // 电场强度 = k * q / r²，这里简化k=1，q=±1
            const fieldMagnitude = (charge.isPositive ? 1 : -1) / (distance * distance);
            const fieldContribution = displacement.multiplyScalar(fieldMagnitude);

            totalField.add(fieldContribution);
        });

        return totalField;
    }
}

// 电荷类
class Charge {
    mesh: THREE.Group;
    sphere: THREE.Mesh;
    text: THREE.Mesh | any;
    isPositive: boolean;
    position: THREE.Vector3;
    static allCharges: Charge[] = [];

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

        // 将自己添加到静态数组中
        Charge.allCharges.push(this);
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
        const material = new THREE.SpriteMaterial({map: texture});
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
        // 重新生成所有电场线
        FieldLineManager.generateAllFieldLines();
    }

    setPosition(position: THREE.Vector3) {
        this.position.copy(position);
        this.mesh.position.copy(position);
        // 重新生成所有电场线
        FieldLineManager.generateAllFieldLines();
    }
}

// 创建两个电荷
const charge1 = new Charge(true, new THREE.Vector3(-3, 0, 0));
const charge2 = new Charge(false, new THREE.Vector3(3, 0, 0));

// 初始化电场线
FieldLineManager.generateAllFieldLines();

// 创建连接线
const lineGeometry = new THREE.BufferGeometry().setFromPoints([
    charge1.position,
    charge2.position
]);
const lineMaterial = new THREE.LineDashedMaterial({
    color: 0xaaaaaa,
    dashSize: 0.2,
    gapSize: 0.1,
});
const line = new THREE.Line(lineGeometry, lineMaterial);
line.computeLineDistances();
scene.add(line);

// 更新所有电场线
function updateAllFieldLines() {
    FieldLineManager.generateAllFieldLines();
}

// 更新连接线
function updateLine() {
    const positions = new Float32Array([
        charge1.position.x, charge1.position.y, charge1.position.z,
        charge2.position.x, charge2.position.y, charge2.position.z
    ]);
    line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    line.computeLineDistances();

    // 同时更新电场线
    updateAllFieldLines();
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
    // 恢复直线约束：电荷只能在X轴上移动
    const constrainedPosition = new THREE.Vector3(position.x, 0, 0);

    // 添加边界限制，防止电荷移动过远
    const maxDistance = 8;
    if (Math.abs(constrainedPosition.x) > maxDistance) {
        constrainedPosition.x = Math.sign(constrainedPosition.x) * maxDistance;
    }

    return constrainedPosition;
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
            // 恢复直线约束，电荷只能沿X轴移动
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
}, {passive: false});

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
            // 恢复直线约束，电荷只能沿X轴移动
            const constrainedPosition = constrainToLine(newPosition);
            dragTarget.setPosition(constrainedPosition);
            updateLine();
        }
    }
}, {passive: false});

renderer.domElement.addEventListener('touchend', (event) => {
    event.preventDefault();
    isDragging = false;
    dragTarget = null;
    controls.enabled = true;
}, {passive: false});

// 窗口调整
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 更新所有电场线材质的分辨率
    FieldLineManager.fieldLines.forEach(fieldLine => {
        const material = fieldLine.line.material as LineMaterial;
        material.resolution.set(window.innerWidth, window.innerHeight);
    });
});

// 渲染循环
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

animate();
