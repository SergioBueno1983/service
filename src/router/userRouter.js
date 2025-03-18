const Client = require("../models/Client");
const User = require("../models/User");
const Walker = require("../models/Walker");
const sequelize = require("../config/db.js");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sharp = require("sharp");
const authMiddleware = require("../middlewares/authMiddleware");

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { User, Walker } = require("../models");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

const IMAGES_DIR = path.resolve(__dirname, "../../SFS_DogWalking_Services/images");
const DEFAULT_IMAGE_PATH = path.join(IMAGES_DIR, "no_image.png");

// Crear directorio si no existe
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Carpeta temporal
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Subir foto de perfil de usuario
router.post("/image/single/:nameImage", authMiddleware, upload.single("imagenPerfil"), async (req, res) => {
  try {
    const username = req.params.nameImage;
    const user = await User.findOne({ where: { nombre_usuario: username } });
    if (!user) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

    const fileName = `${username}.webp`;
    const filePath = path.join(IMAGES_DIR, fileName);

    await sharp(req.file.path)
      .resize(500, 500, { fit: "cover" })
      .toFormat("webp")
      .toFile(filePath);

    fs.unlinkSync(req.file.path);
    await user.update({ foto: fileName });

    res.status(200).json({ ok: true, message: "Imagen de perfil actualizada", fileName });
  } catch (error) {
    console.error("Error al subir imagen:", error);
    res.status(500).json({ ok: false, message: "Error al actualizar imagen" });
  }
});

// Subir fotos del paseador
router.post("/image/walker/single/:walkerId", authMiddleware, upload.single("imagenPaseador"), async (req, res) => {
  try {
    const walkerId = req.params.walkerId;
    const walker = await Walker.findOne({ where: { id: walkerId }, include: User });
    if (!walker) return res.status(404).json({ ok: false, message: "Paseador no encontrado" });

    const currentFotos = walker.fotos || [];
    const newCounter = currentFotos.length + 1;
    const fileName = `p${walkerId}_${newCounter}.webp`;
    const filePath = path.join(IMAGES_DIR, fileName);

    await sharp(req.file.path)
      .resize(500, 500, { fit: "cover" })
      .toFormat("webp")
      .toFile(filePath);

    fs.unlinkSync(req.file.path);
    await walker.update({ fotos: [...currentFotos, { url: fileName }] });

    res.status(200).json({ ok: true, message: "Foto subida con éxito", fileName });
  } catch (error) {
    console.error("Error al subir foto del paseador:", error);
    res.status(500).json({ ok: false, message: "Error al actualizar imagen" });
  }
});

// Obtener imagen de usuario
router.get("/image/single/:nameImage", authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ where: { nombre_usuario: req.params.nameImage } });
    if (!user || !user.foto) return res.sendFile(DEFAULT_IMAGE_PATH);
    res.sendFile(path.join(IMAGES_DIR, user.foto));
  } catch (error) {
    console.error("Error al obtener imagen:", error);
    res.status(500).send("Error interno del servidor");
  }
});

// Obtener imagen de paseador
router.get("/image/walkers/:imageName", authMiddleware, (req, res) => {
  const imagePath = path.join(IMAGES_DIR, req.params.imageName);
  if (!fs.existsSync(imagePath)) return res.status(404).send("Imagen no encontrada");
  res.sendFile(imagePath);
});

module.exports = router;


router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    // Busca el usuario por su nombre de usuario en la base de datos
    const user = await User.findOne({
      where: {
        nombre_usuario: username,
      },
    });

    var contraseniaCoincide = false;
    if (user)
      contraseniaCoincide = bcrypt.compareSync(password, user.contraseña);

    // Si no se encuentra el usuario o la contraseña no coincide, responde con un error de autenticación
    if (!user || !contraseniaCoincide) {
      return res
        .status(401)
        .json({ ok: false, message: "Usuario y/o contraseña incorrecta" });
    }

    const client = await Client.findByPk(user.id);
    // Si no encontro el cliente, significa que es paseador
    var logedUser;
    if (client === null) {
      // Agrega un atributo 'tipo' al objeto del usuario
      logedUser = user.toJSON(); // Convertimos el modelo Sequelize a un objeto JSON
      logedUser.tipo = "walker";
    } else {
      logedUser = user.toJSON();
      logedUser.tipo = "client";
    }

    // Si el usuario y la contraseña son correctos, devuelves el usuario encontrado
    res.status(200).json({
      ok: true,
      logedUser,
      token: jwt.sign({ userId: user.id }, process.env.JWT_SECRET),
    });
  } catch (error) {
    console.error("Error de autenticación:", error);
    res.status(500).json({ ok: false, message: "Error de autenticación" });
  }
});

// Modificar datos básicos del usuario (incluyendo la contraseña)
router.put("/users/password/:user_id", authMiddleware, async (req, res) => {
  try {
    const userData = req.body;
    const id = req.params.user_id; // Corregido el parámetro
    const newContraseña = userData.newContraseña
      ? bcrypt.hashSync(userData.newContraseña, 10)
      : null; // Solo generar hash si hay nueva contraseña
    const contraseña = userData.contraseña;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        ok: false,
        status: 404,
        message: "Usuario no encontrado",
      });
    }

    // Comparar contraseña actual
    const isMatch = await bcrypt.compare(contraseña, user.contraseña);
    if (!isMatch) {
      return res.status(400).json({
        ok: false,
        status: 400,
        message: "La contraseña actual no es correcta",
      });
    }

    // Modificar el usuario
    await User.update(
      {
        contraseña: newContraseña,
        direccion: userData.direccion,
        email: userData.email,
        telefono: userData.telefono,
      },
      {
        where: {
          id: id,
        },
      }
    );

    return res.status(200).json({
      ok: true,
      status: 200,
      message: "Usuario modificado exitosamente",
    });
  } catch (error) {
    console.error("Error al modificar usuario:", error);
    return res.status(500).json({
      ok: false,
      status: 500,
      message: error.message || "Error al modificar usuario",
      error: error.message || "Error inesperado",
    });
  }
});

// Modificar datos básicos del usuario (sin cambiar contraseña)
router.put("/users/:user_id", authMiddleware, async (req, res) => {
  try {
    const userData = req.body;
    const id = req.params.user_id; // Corregido el parámetro

    // Modificar el usuario
    await User.update(
      {
        direccion: userData.direccion,
        email: userData.email,
        telefono: userData.telefono,
      },
      {
        where: {
          id: id,
        },
      }
    );

    return res.status(200).json({
      ok: true,
      status: 200,
      message: "Usuario modificado exitosamente",
    });
  } catch (error) {
    console.error("Error al modificar usuario:", error);
    return res.status(500).json({
      ok: false,
      status: 500,
      message: error.message || "Error al modificar usuario",
      error: error.message || "Error inesperado",
    });
  }
});

module.exports = router;
