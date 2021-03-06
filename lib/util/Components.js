/**
 * @fileoverview Utility class and functions for React components detection
 * @author Yannick Croissant
 */
'use strict';

var util = require('util');

/**
 * Components
 * @class
 */
function Components() {
  this._list = {};
  this._getId = function(node) {
    return node && node.range.join(':');
  };
}

/**
 * Add a node to the components list, or update it if it's already in the list
 *
 * @param {ASTNode} node The AST node being added.
 * @param {Object} props Additional properties to add to the component.
 */
Components.prototype.add = function(node, props) {
  var id = this._getId(node);
  if (this._list[id]) {
    this._list[id] = util._extend(this._list[id], props);
    return;
  }
  props.node = node;
  this._list[id] = props;
};

/**
 * Find a component in the list using its node
 *
 * @param {ASTNode} node The AST node being searched.
 * @returns {Object} Component object, undefined if the component is not found
 */
Components.prototype.get = function(node) {
  var id = this._getId(node);
  return this._list[id];
};

/**
 * Update a component in the list
 *
 * @param {ASTNode} node The AST node being updated.
 * @param {Object} props Additional properties to add to the component.
 */
Components.prototype.set = function(node, props) {
  while (node && !this._list[this._getId(node)]) {
    node = node.parent;
  }
  if (!node) {
    return;
  }
  var id = this._getId(node);
  this._list[id] = util._extend(this._list[id], props);
};

/**
 * Return the components list
 * Components for which we are not confident are not returned
 *
 * @returns {Object} Components list
 */
Components.prototype.list = function() {
  var list = {};
  for (var i in this._list) {
    if (!this._list.hasOwnProperty(i) || !this._list[i].confident) {
      continue;
    }
    list[i] = this._list[i];
  }
  return list;
};

/**
 * Return the length of the components list
 * Components for which we are not confident are not counted
 *
 * @returns {Number} Components list length
 */
Components.prototype.length = function() {
  var length = 0;
  for (var i in this._list) {
    if (!this._list.hasOwnProperty(i) || !this._list[i].confident) {
      continue;
    }
    length++;
  }
  return length;
};

function componentRule(rule, context) {

  var sourceCode = context.getSourceCode();
  var components = new Components();

  // Utilities for component detection
  context.react = {

    /**
     * Check if the node is a React ES5 component
     *
     * @param {ASTNode} node The AST node being checked.
     * @returns {Boolean} True if the node is a React ES5 component, false if not
     */
    isES5Component: function(node) {
      return sourceCode.getText(node.parent.callee) === 'React.createClass';
    },

    /**
     * Check if the node is a React ES6 component
     *
     * @param {ASTNode} node The AST node being checked.
     * @returns {Boolean} True if the node is a React ES6 component, false if not
     */
    isES6Component: function(node) {
      if (!node.superClass) {
        return false;
      }
      return /^(React\.)?Component$/.test(sourceCode.getText(node.superClass));
    },

    /**
     * Check if the node is returning JSX
     *
     * @param {ASTNode} node The AST node being checked (must be a ReturnStatement).
     * @returns {Boolean} True if the node is returning JSX, false if not
     */
    isReturningJSX: function(node) {
      if (node.type !== 'ReturnStatement') {
        return false;
      }

      var returnsJSX =
        node.argument &&
        node.argument.type === 'JSXElement'
      ;
      var returnsReactCreateElement =
        node.argument &&
        node.argument.callee &&
        node.argument.callee.property &&
        node.argument.callee.property.name === 'createElement'
      ;

      return Boolean(returnsJSX || returnsReactCreateElement);
    },

    /**
     * Get the parent component node from the current scope
     *
     * @returns {ASTNode} component node, null if we are not in a component
     */
    getParentComponent: function() {
      return (
        context.react.getParentES6Component() ||
        context.react.getParentES5Component() ||
        context.react.getParentStatelessComponent()
      );
    },

    /**
     * Get the parent ES5 component node from the current scope
     *
     * @returns {ASTNode} component node, null if we are not in a component
     */
    getParentES5Component: function() {
      var scope = context.getScope();
      var node = scope.block && scope.block.parent && scope.block.parent.parent;
      if (!node || !context.react.isES5Component(node)) {
        return null;
      }
      return node;
    },

    /**
     * Get the parent ES6 component node from the current scope
     *
     * @returns {ASTNode} component node, null if we are not in a component
     */
    getParentES6Component: function() {
      var scope = context.getScope();
      while (scope && scope.type !== 'class') {
        scope = scope.upper;
      }
      var node = scope && scope.block;
      if (!node || !node.superClass) {
        return null;
      }
      return node;
    },

    /**
     * Get the parent stateless component node from the current scope
     *
     * @returns {ASTNode} component node, null if we are not in a component
     */
    getParentStatelessComponent: function() {
      var scope = context.getScope();
      var node = scope.block;
      var isNotAFunction = !/Function/.test(node.type); // Ignore non functions
      var isMethod = node.parent && node.parent.type === 'MethodDefinition'; // Ignore classes methods
      var isArgument = node.parent && node.parent.type === 'CallExpression'; // Ignore arguments (map, callback, etc.)
      if (isNotAFunction || isMethod || isArgument) {
        return null;
      }
      return node;
    },

    /**
     * Get the related component from a node
     *
     * @param {ASTNode} node The AST node being checked (must be a MemberExpression).
     * @returns {ASTNode} component node, null if we cannot find the component
     */
    getRelatedComponent: function(node) {
      var i;
      var j;
      var k;
      var l;
      // Get the component path
      var componentPath = [];
      while (node) {
        if (node.property && node.property.type === 'Identifier') {
          componentPath.push(node.property.name);
        }
        if (node.object && node.object.type === 'Identifier') {
          componentPath.push(node.object.name);
        }
        node = node.object;
      }
      componentPath.reverse();

      // Find the variable in the current scope
      var variableName = componentPath.shift();
      if (!variableName) {
        return null;
      }
      var variableInScope;
      var variables = context.getScope().variables;
      for (i = 0, j = variables.length; i < j; i++) {
        if (variables[i].name === variableName) {
          variableInScope = variables[i];
          break;
        }
      }
      if (!variableInScope) {
        return null;
      }

      // Find the variable declaration
      var defInScope;
      var defs = variableInScope.defs;
      for (i = 0, j = defs.length; i < j; i++) {
        if (defs[i].type === 'ClassName' || defs[i].type === 'FunctionName' || defs[i].type === 'Variable') {
          defInScope = defs[i];
          break;
        }
      }
      if (!defInScope) {
        return null;
      }
      node = defInScope.node.init || defInScope.node;

      // Traverse the node properties to the component declaration
      for (i = 0, j = componentPath.length; i < j; i++) {
        if (!node.properties) {
          continue;
        }
        for (k = 0, l = node.properties.length; k < l; k++) {
          if (node.properties[k].key.name === componentPath[i]) {
            node = node.properties[k];
            break;
          }
        }
        if (!node) {
          return null;
        }
        node = node.value;
      }

      // Return the component
      return components.get(node);
    }
  };

  // Component detection instructions
  var detectionInstructions = {
    ClassDeclaration: function(node) {
      if (!context.react.isES6Component(node)) {
        return;
      }
      components.add(node, {confident: true});
    },

    ClassProperty: function(node) {
      node = context.react.getParentComponent();
      if (!node) {
        return;
      }
      components.add(node, {confident: true});
    },

    ObjectExpression: function(node) {
      if (!context.react.isES5Component(node)) {
        return;
      }
      components.add(node, {confident: true});
    },

    FunctionExpression: function(node) {
      node = context.react.getParentComponent();
      if (!node) {
        return;
      }
      var component = components.get(node);
      components.add(node, {confident: component && component.confident || false});
    },

    FunctionDeclaration: function(node) {
      node = context.react.getParentComponent();
      if (!node) {
        return;
      }
      var component = components.get(node);
      components.add(node, {confident: component && component.confident || false});
    },

    ArrowFunctionExpression: function(node) {
      node = context.react.getParentComponent();
      if (!node) {
        return;
      }
      var component = components.get(node);
      components.add(node, {confident: component && component.confident || false});
    },

    ReturnStatement: function(node) {
      if (!context.react.isReturningJSX(node)) {
        return;
      }
      node = context.react.getParentComponent();
      if (!node) {
        return;
      }
      components.add(node, {confident: true});
    }
  };

  // Update the provided rule instructions to add the component detection
  var ruleInstructions = rule(context, components);
  var updatedRuleInstructions = util._extend({}, ruleInstructions);
  Object.keys(detectionInstructions).forEach(function(instruction) {
    updatedRuleInstructions[instruction] = function(node) {
      detectionInstructions[instruction](node);
      return ruleInstructions[instruction] ? ruleInstructions[instruction](node) : void 0;
    };
  });
  // Return the updated rule instructions
  return updatedRuleInstructions;
}

Components.detect = function(rule) {
  return componentRule.bind(this, rule);
};

module.exports = Components;
