#version 330 core
// Project-authored native fire proxy shader; no image planes.
in vec4 vertex;
uniform mat4 worldviewproj_matrix;
out vec3 objectPosition;
void main() {
    objectPosition=vertex.xyz;
    gl_Position=worldviewproj_matrix*vertex;
}
