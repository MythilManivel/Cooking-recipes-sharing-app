const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Recipe = require('../models/Recipe');
const { protect, checkOwnership } = require('../middleware/auth');

// Transform incoming client payload to Recipe schema shape
function normalizeRecipePayload(body, authorId) {
  const {
    title,
    description,
    category,
    cuisine,
    prepTime,
    cookTime,
    servings,
    difficulty,
    ingredients = [],
    instructions = [],
    tags = [],
    image,
    dietary = [],
  } = body;

  // Map difficulty to model's enum
  const allowedDifficulties = ['Easy', 'Medium', 'Hard'];
  const normalizedDifficulty = allowedDifficulties.includes(difficulty)
    ? difficulty
    : (difficulty === 'Expert' ? 'Hard' : 'Medium');

  // Default cuisine to 'Other' if not provided
  const normalizedCuisine = cuisine && cuisine.trim() ? cuisine : 'Other';

  // Ingredients: client sends array of strings; map to minimal ingredient objects
  const normalizedIngredients = ingredients
    .filter(Boolean)
    .map((text) => ({ name: String(text), quantity: '1', unit: '' }));

  // Instructions: client sends array of strings; map to { step, text }
  const normalizedInstructions = instructions
    .filter(Boolean)
    .map((text, idx) => ({ step: idx + 1, text: String(text) }));

  // Images: optional single URL from client image or leave empty
  const images = image
    ? [{ url: image, isPrimary: true }]
    : [];

  return {
    title,
    description,
    category,
    cuisine: normalizedCuisine,
    prepTime: Number(prepTime) || 1,
    cookingTime: Number(cookTime) || 1,
    servings: Number(servings) || 1,
    difficulty: normalizedDifficulty,
    ingredients: normalizedIngredients,
    instructions: normalizedInstructions,
    tags,
    dietary,
    images,
    author: new mongoose.Types.ObjectId(authorId),
    isPublic: true,
    isPublished: true,
  };
}

// GET /api/recipes - list public recipes
router.get('/', async (req, res) => {
  try {
    const recipes = await Recipe.find({ isPublic: true, isPublished: true })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('author', 'name email');
    res.json({ recipes });
  } catch (err) {
    console.error('List recipes error:', err);
    res.status(500).json({ error: 'Failed to fetch recipes' });
  }
});

// GET /api/recipes/my - list current user's recipes
router.get('/my', protect, async (req, res) => {
  try {
    const recipes = await Recipe.find({ author: req.user._id })
      .sort({ createdAt: -1 });
    res.json({ recipes });
  } catch (err) {
    console.error('My recipes error:', err);
    res.status(500).json({ error: 'Failed to fetch your recipes' });
  }
});

// GET /api/recipes/favorites - recipes liked by current user
router.get('/favorites', protect, async (req, res) => {
  try {
    const recipes = await Recipe.find({ likes: req.user._id })
      .sort({ createdAt: -1 });
    res.json({ recipes });
  } catch (err) {
    console.error('Favorites error:', err);
    res.status(500).json({ error: 'Failed to fetch favorite recipes' });
  }
});

// GET /api/recipes/search - simple search by text and filters
router.get('/search', async (req, res) => {
  try {
    const { q, category, cuisine, difficulty } = req.query;
    const query = { isPublic: true, isPublished: true };
    if (q) {
      query.$or = [
        { title: new RegExp(q, 'i') },
        { description: new RegExp(q, 'i') },
        { tags: new RegExp(q, 'i') },
      ];
    }
    if (category) query.category = category;
    if (cuisine) query.cuisine = cuisine;
    if (difficulty) query.difficulty = difficulty;

    const recipes = await Recipe.find(query).sort({ createdAt: -1 });
    res.json({ recipes });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Failed to search recipes' });
  }
});

// GET /api/recipes/:id - get one recipe
router.get('/:id', async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id).populate('author', 'name email');
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
    res.json(recipe);
  } catch (err) {
    console.error('Get recipe error:', err);
    res.status(500).json({ error: 'Failed to fetch recipe' });
  }
});

// POST /api/recipes - create
router.post('/', protect, async (req, res) => {
  try {
    const payload = normalizeRecipePayload(req.body, req.user._id);
    const recipe = await Recipe.create(payload);
    res.json({ recipe, message: 'Recipe created successfully' });
  } catch (err) {
    console.error('Create recipe error:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(err.errors)[0]?.message || 'Validation error' });
    }
    res.status(500).json({ error: 'Failed to create recipe' });
  }
});

// PUT /api/recipes/:id - update (owner only)
router.put('/:id', protect, checkOwnership(Recipe, 'id', 'author'), async (req, res) => {
  try {
    const payload = normalizeRecipePayload({ ...req.body, image: req.body.image || undefined }, req.user._id);
    // Prevent changing author
    delete payload.author;

    const updated = await Recipe.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true, runValidators: true }
    );
    res.json({ recipe: updated, message: 'Recipe updated successfully' });
  } catch (err) {
    console.error('Update recipe error:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(err.errors)[0]?.message || 'Validation error' });
    }
    res.status(500).json({ error: 'Failed to update recipe' });
  }
});

// DELETE /api/recipes/:id - delete (owner only)
router.delete('/:id', protect, checkOwnership(Recipe, 'id', 'author'), async (req, res) => {
  try {
    await Recipe.findByIdAndDelete(req.params.id);
    res.json({ message: 'Recipe deleted successfully' });
  } catch (err) {
    console.error('Delete recipe error:', err);
    res.status(500).json({ error: 'Failed to delete recipe' });
  }
});

// POST /api/recipes/:id/favorite - toggle like/favorite
router.post('/:id/favorite', protect, async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    const userId = req.user._id.toString();
    const idx = recipe.likes.findIndex((u) => u.toString() === userId);
    if (idx >= 0) {
      recipe.likes.splice(idx, 1);
    } else {
      recipe.likes.push(req.user._id);
    }
    await recipe.save();
    res.json({
      recipe,
      favorited: idx === -1,
      message: idx === -1 ? 'Recipe added to favorites' : 'Recipe removed from favorites',
    });
  } catch (err) {
    console.error('Toggle favorite error:', err);
    res.status(500).json({ error: 'Failed to update favorite' });
  }
});

module.exports = router;